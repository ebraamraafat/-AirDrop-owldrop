import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BUS_NAME = 'io.github.t4t5.Owly';
const OBJ_PATH = '/io/github/t4t5/Owly';
const RADIO_IFACE = 'io.github.t4t5.Owly.Radio1';

const SIGINT = 2;

export default class OwlDropExtension extends Extension {
    enable() {
        this._cancellable = new Gio.Cancellable();
        this._timers = new Set();

        this._radio = null;
        this._receiver = null;
        this._sender = null;

        this._active = false;
        this._radioState = 'idle';
        this._receiveScheduled = false;
        this._receiveRetries = 0;
        this._dbusSub = 0;
        this._dirMonitor = null;
        this._monitorId = 0;

        const downloads =
            GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ??
            GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
        this._recvDir = GLib.build_filenamev([downloads, 'AirDrop']);
        GLib.mkdir_with_parents(this._recvDir, 0o755);

        this._buildUI();
        this._subscribeRadioState();

        Main.panel.addToStatusArea('owldrop', this._indicator);
    }

    // ---------------------------------------------------------------- UI

    _buildUI() {
        this._indicator = new PanelMenu.Button(0.0, 'OwlDrop');

        this._icon = new St.Icon({
            icon_name: 'network-wireless-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(this._icon);

        const menu = this._indicator.menu;

        this._status = new PopupMenu.PopupMenuItem('AirDrop is OFF', {reactive: false});
        menu.addMenuItem(this._status);

        this._switch = new PopupMenu.PopupSwitchMenuItem('AirDrop', false);
        this._switch.connect('toggled', (_item, state) => {
            if (state)
                this._startAirDrop();
            else
                this._stopAirDrop();
        });
        menu.addMenuItem(this._switch);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._sendItem = new PopupMenu.PopupMenuItem('Send files…');
        this._sendItem.connect('activate', () => this._pickAndSend());
        menu.addMenuItem(this._sendItem);

        const openItem = new PopupMenu.PopupMenuItem('Open received files');
        openItem.connect('activate', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(
                    GLib.filename_to_uri(this._recvDir, null), null);
            } catch (e) {
                console.error(`OwlDrop: ${e.message}`);
            }
        });
        menu.addMenuItem(openItem);

        this._refreshUI();
    }

    _refreshUI() {
        this._icon.opacity = this._active ? 255 : 120;
        this._sendItem.setSensitive(this._active && !this._sender);

        if (this._switch.state !== this._active)
            this._switch.setToggleState(this._active);
    }

    _setStatus(message) {
        this._status.label.set_text(message);
    }

    _notify(title, body) {
        Main.notify(title, body);
    }

    // ------------------------------------------------------------ helpers

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
        return id;
    }

    _logOutput(proc, tag) {
        const pipe = proc.get_stdout_pipe();
        if (!pipe)
            return;

        const stream = new Gio.DataInputStream({
            base_stream: pipe,
            close_base_stream: true,
        });

        const readNext = () => {
            stream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (s, res) => {
                try {
                    const [line] = s.read_line_finish_utf8(res);
                    if (line === null)
                        return;
                    console.log(`OwlDrop[${tag}]: ${line}`);
                    readNext();
                } catch (_e) {
                    // cancelled or stream closed
                }
            });
        };
        readNext();
    }

    _terminate(proc) {
        if (!proc)
            return;

        try {
            // Ctrl-C equivalent so owly releases the radio lease cleanly.
            proc.send_signal(SIGINT);
        } catch (_e) {
            return;
        }

        this._later(3000, () => {
            try {
                proc.force_exit();
            } catch (_e) {
                // already gone
            }
        });
    }

    // -------------------------------------------------- radio state (D-Bus)

    _subscribeRadioState() {
        this._dbusSub = Gio.DBus.system.signal_subscribe(
            BUS_NAME,
            'org.freedesktop.DBus.Properties',
            'PropertiesChanged',
            OBJ_PATH,
            RADIO_IFACE,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                try {
                    const [, changed] = params.recursiveUnpack();
                    if (changed && 'State' in changed)
                        this._onRadioState(changed.State);
                } catch (e) {
                    console.error(`OwlDrop: bad PropertiesChanged: ${e.message}`);
                }
            });
    }

    _onRadioState(state) {
        this._radioState = state;
        console.log(`OwlDrop: radio state -> ${state}`);

        if (!this._radio)
            return;

        if (!this._receiver)
            this._setStatus(`Radio: ${state}`);

        // Anything other than "idle" means the radio session is coming up.
        if (state !== 'idle')
            this._scheduleReceiving(1500);
    }

    // ------------------------------------------------------------ start/stop

    _startAirDrop() {
        if (this._radio)
            return;

        this._receiveRetries = 0;
        this._receiveScheduled = false;

        try {
            this._setStatus('Starting AirDrop…');

            const proc = Gio.Subprocess.new(
                ['owly', 'radio', 'up'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
            this._radio = proc;
            this._active = true;
            this._logOutput(proc, 'radio');

            proc.wait_async(this._cancellable, (p, res) => {
                try {
                    p.wait_finish(res);
                } catch (_e) {
                    return;
                }
                if (this._radio === proc) {
                    this._radio = null;
                    this._onRadioDied(p.get_exit_status());
                }
            });

            // Fallback in case no state change is ever observed.
            this._scheduleReceiving(10000);
        } catch (error) {
            this._radio = null;
            this._active = false;
            this._setStatus('Error starting AirDrop');
            this._notify('OwlDrop', `Could not start: ${error.message}`);
            console.error(`OwlDrop: ${error.message}`);
        }

        this._refreshUI();
    }

    _onRadioDied(status) {
        const rec = this._receiver;
        this._receiver = null;
        this._terminate(rec);
        this._stopMonitor();

        this._active = false;
        this._setStatus('AirDrop stopped');
        this._notify('OwlDrop', `AirDrop radio exited (code ${status}).`);
        this._refreshUI();
    }

    _scheduleReceiving(delayMs) {
        if (this._receiveScheduled || this._receiver || !this._radio)
            return;

        this._receiveScheduled = true;
        this._later(delayMs, () => {
            this._receiveScheduled = false;
            this._startReceiving();
        });
    }

    _startReceiving() {
        if (!this._active || !this._radio || this._receiver)
            return;

        try {
            const proc = Gio.Subprocess.new(
                ['owly', 'receive', '--accept', '--dir', this._recvDir],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
            this._receiver = proc;
            this._logOutput(proc, 'receive');
            this._startMonitor();
            this._setStatus('AirDrop is ON (receiving)');

            proc.wait_async(this._cancellable, (p, res) => {
                try {
                    p.wait_finish(res);
                } catch (_e) {
                    return;
                }
                if (this._receiver !== proc)
                    return;

                this._receiver = null;
                this._stopMonitor();

                if (this._active && this._radio && this._receiveRetries < 3) {
                    this._receiveRetries++;
                    this._setStatus('Receiver restarting…');
                    this._scheduleReceiving(3000);
                } else if (this._active) {
                    this._setStatus('Receiver failed');
                    this._notify('OwlDrop', 'Receiver stopped. See: journalctl -b _COMM=gnome-shell | grep OwlDrop');
                }
            });
        } catch (error) {
            this._receiver = null;
            this._setStatus('Receiver failed');
            console.error(`OwlDrop: ${error.message}`);
        }
    }

    _stopAirDrop() {
        const rec = this._receiver;
        const radio = this._radio;
        this._receiver = null;
        this._radio = null;

        this._terminate(rec);
        this._terminate(radio);
        this._stopMonitor();

        this._active = false;
        this._receiveScheduled = false;
        this._setStatus('AirDrop is OFF');
        this._refreshUI();
    }

    // ----------------------------------------------- received-file notifier

    _startMonitor() {
        if (this._dirMonitor)
            return;

        try {
            const dir = Gio.File.new_for_path(this._recvDir);
            this._dirMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._dirMonitor.connect('changed', (_m, file, _other, event) => {
                if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
                    this._notify('AirDrop: file received', file.get_basename());
                }
            });
        } catch (e) {
            console.error(`OwlDrop: monitor failed: ${e.message}`);
        }
    }

    _stopMonitor() {
        if (!this._dirMonitor)
            return;

        if (this._monitorId)
            this._dirMonitor.disconnect(this._monitorId);
        this._dirMonitor.cancel();
        this._dirMonitor = null;
        this._monitorId = 0;
    }

    // ------------------------------------------------------------- sending

    _pickAndSend() {
        if (!this._active || this._sender)
            return;

        let picker;
        try {
            picker = Gio.Subprocess.new(
                ['zenity', '--file-selection', '--multiple',
                    '--separator=\n', '--title=Send with AirDrop'],
                Gio.SubprocessFlags.STDOUT_PIPE);
        } catch (e) {
            this._notify('OwlDrop', 'zenity is required for the file picker: sudo dnf install zenity');
            return;
        }

        picker.communicate_utf8_async(null, this._cancellable, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                if (!p.get_successful())
                    return;

                const files = stdout.split('\n').map(s => s.trim()).filter(Boolean);
                if (files.length > 0)
                    this._send(files);
            } catch (_e) {
                // cancelled
            }
        });
    }

    _send(files) {
        if (this._sender)
            return;

        try {
            const proc = Gio.Subprocess.new(
                ['owly', 'send', ...files],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this._sender = proc;
            this._setStatus(`Sending ${files.length} file(s)… (looking for receiver)`);
            this._refreshUI();

            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                let stdout = '';
                let stderr = '';
                try {
                    [, stdout, stderr] = p.communicate_utf8_finish(res);
                } catch (_e) {
                    return;
                }

                this._sender = null;
                console.log(`OwlDrop[send]: ${stdout} ${stderr}`);

                if (p.get_successful()) {
                    this._notify('AirDrop', 'Sent successfully.');
                } else {
                    const tail = (stderr || stdout || '').trim().split('\n').pop();
                    this._notify('AirDrop: send failed', tail || 'Unknown error');
                }

                if (this._active) {
                    this._setStatus(this._receiver
                        ? 'AirDrop is ON (receiving)'
                        : `Radio: ${this._radioState}`);
                }
                this._refreshUI();
            });
        } catch (e) {
            this._sender = null;
            this._notify('OwlDrop', `Send failed: ${e.message}`);
            this._refreshUI();
        }
    }

    // ------------------------------------------------------------- disable

    disable() {
        this._cancellable?.cancel();

        this._stopAirDrop();
        this._terminate(this._sender);
        this._sender = null;

        if (this._dbusSub) {
            Gio.DBus.system.signal_unsubscribe(this._dbusSub);
            this._dbusSub = 0;
        }

        for (const id of this._timers)
            GLib.Source.remove(id);
        this._timers.clear();

        this._indicator?.destroy();
        this._indicator = null;
        this._cancellable = null;
    }
}
