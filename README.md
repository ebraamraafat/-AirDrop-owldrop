# OwlDrop

A GNOME Shell extension that adds an AirDrop-style menu to the top bar on Fedora.
Turn it on, send files to a nearby iPhone, and receive files from it, without touching the terminal.

OwlDrop is only the **interface**. The hard part, the AirDrop protocol over AWDL, is done by
[Owly](https://github.com/t4t5/owly) by t4t5, which builds on the OWL research from the SEEMOO lab.
Without Owly, this extension does nothing. Not affiliated with Apple or the Owly project.
"AirDrop" is an Apple trademark.

## What the extension adds

- A top-bar icon with one switch that starts the radio (`owly radio up`) and the receiver (`owly receive`)
- "Send files..." with a file picker
- Received files saved to `~/Downloads/AirDrop`, with a desktop notification
- Clean shutdown (SIGINT) so Owly releases the Wi-Fi card

## Requirements

- Fedora 44+ with GNOME Shell 50 (Wayland)
- A Wi-Fi card that Owly supports. Run `owly doctor` to check. See Owly's supported-hardware list.
- `zenity` for the file picker: `sudo dnf install zenity`
- iPhone/iPad with AirDrop set to **Everyone** (or "Everyone for 10 Minutes")

## Install

**1. Install Owly** (download the `.rpm` from the [Owly releases page](https://github.com/t4t5/owly/releases)):

```bash
sudo dnf install ./owly-*.x86_64.rpm
owly doctor        # should say your card can do AirDrop
```

**2. Install the extension:**

```bash
git clone https://github.com/ebraamraafat/owldrop.git \
  ~/.local/share/gnome-shell/extensions/owldrop@ebraamraafat.dev
gnome-extensions enable owldrop@ebraamraafat.dev
```

**3. Log out and log back in** (needed once on Wayland). The OwlDrop icon appears in the top bar.

The installation steps are in the terminal, but after that everything is done from the top-bar menu.

## Usage

1. Click the top-bar icon and turn on the **AirDrop** switch.
2. To receive: open AirDrop on the iPhone and share to your computer's name.
3. To send: click **Send files...**, pick files, keep the iPhone on its AirDrop screen.

## Known limitations

- Enabling the radio takes over the Wi-Fi card, so your normal Wi-Fi drops while AirDrop is on.
- On Intel cards AWDL runs on channel 6, so transfers are slow (a 2.4 MB photo takes about 10-17 s).
- Sending goes to the first receiver found. A device picker is not implemented yet.
- Incoming transfers are accepted automatically (`--accept`). Only turn it on when you want to receive.

## Debugging

```bash
journalctl -b _COMM=gnome-shell --no-pager | grep OwlDrop
gnome-extensions info owldrop@ebraamraafat.dev
```

## AI disclosure

Parts of this extension's code were written with the help of Claude (Anthropic) and tested by hand.

## License

GPL-3.0. Owly is a separate project with its own license.
