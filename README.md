# OwlDrop

A GNOME Shell extension that puts an AirDrop-style send/receive menu in the top bar on Fedora.

OwlDrop is only a front-end. All the actual protocol work (AWDL, discovery, transfers) is done by
[Owly](https://github.com/t4t5/owly) and its `owlyd` service. You need Owly installed and working first.

> Not affiliated with Apple or the Owly project. "AirDrop" is an Apple trademark.

## Features

- Top-bar indicator with one switch that starts the radio (`owly radio up`) and the receiver (`owly receive`)
- Send files from a file picker (`owly send`)
- Received files go to `~/Downloads/AirDrop`, with a desktop notification
- Clean shutdown: stops the processes with SIGINT so Owly releases the Wi-Fi card

## Requirements

- Fedora with GNOME Shell 50 (Wayland)
- [Owly](https://github.com/t4t5/owly) with `owlyd` running (`owly doctor` should report a supported card)
- `zenity` for the file picker: `sudo dnf install zenity`
- An iPhone/iPad with AirDrop set to **Everyone**

## Install

```bash
git clone https://github.com/<your-username>/owldrop.git \
  ~/.local/share/gnome-shell/extensions/owldrop@ebraamraafat.dev
gnome-extensions enable owldrop@ebraamraafat.dev
```

On Wayland, log out and back in the first time so the Shell picks it up.

## Known limitations

- Enabling the radio takes over the Wi-Fi card, so your normal Wi-Fi connection drops while AirDrop is on.
- Intel cards run AWDL on channel 6, so transfers are slow (a 2.4 MB photo takes roughly 10-17 s).
- Sending goes to the first receiver found. A device picker is not implemented yet.
- Incoming transfers are accepted automatically (`--accept`). Only turn it on when you want to receive.

## Debugging

```bash
journalctl -b _COMM=gnome-shell --no-pager | grep OwlDrop
gnome-extensions info owldrop@ebraamraafat.dev
```

## AI disclosure

Parts of this extension's code were written with the help of Claude (Anthropic) and then tested by hand.

## License

Pick one and add a `LICENSE` file (GPL-3.0-or-later is the usual choice for GNOME extensions).
Check Owly's own license too, since this project depends on it.
