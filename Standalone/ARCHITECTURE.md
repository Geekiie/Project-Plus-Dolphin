# How the standalone rollback fork works

The installed YouGame application bundles a Dolphin fork named Orca. The installation inspected here first shipped 0.3.25 and had updated its runtime to 0.3.28. Its `SOURCE.txt` links [Lrosias/orca-netplay, tag orca-0.3.28](https://github.com/Lrosias/orca-netplay/tree/orca-0.3.28). The older `Lrosias/orca` URL in the original installation's manifest is unavailable; the public source repository is `orca-netplay`.

The Project+ installation is a separate `Project+ Netplay Launcher.dol` plus a 2,097,152,000-byte `sd.raw`, run with Brawl as Dolphin's default disc. The platform's launcher does not patch the ISO in place. The disc inspected was an 8,511,160,320-byte `RSBE01`, revision 2 image. Standalone's importer also leaves that file in place, fingerprints it, and passes its path as a single process argument.

## Emulation and rollback

1. `Core/Orca/Profile.cpp` verifies the Project+ launcher and SD image against `Data/Sys/Orca/PPLUS32.ini`. The profile identifies Brawl's frame boundary at `0x80017504`, with instruction `0x90170100`.
2. `Core/Rollback/Rollback.cpp` reaches that boundary on the CPU thread, after one emulated frame. `MachineState` saves the CPU, device and event state, and `Cow` tracks modified RAM pages instead of copying all RAM each frame.
3. `Core/Orca/Session/Session.cpp` delays local inputs by a small configured amount and predicts missing remote inputs. `PadCodec` supplies the inputs through the emulated GameCube controller hardware.
4. When the real input disagrees, the session restores a snapshot and simulates the intervening frames again. The CPU still runs the game's draw code; the emulator parses graphics commands and skips expensive host rendering during replay.
5. Peers exchange checksums of confirmed snapshots. A disagreement ends the synchronized session instead of continuing divergent play.

Game patches and menu logic are a separate imported layer. They alter running game memory, including online menus and player tags, but the rollback engine does not depend on Melee-style injected game logic. Upstream's claims about cross-platform determinism and performance are preserved in ORCA_ARCHITECTURE.md; this work only claims the local tests recorded in VALIDATION.md.

## Standalone networking

`Standalone/relay.mjs` independently implements the protocol expected by `Core/Orca/Session/YouGameRoom.cpp`:

- `POST /api/multiplayer/ticket`: creates a short-lived opaque ticket bound to a room, player, game mode and compatibility key. An optional relay access key limits access.
- `/room/<code>?ticket=<ticket>`: the WebSocket room sends a welcome, assigns stable controller slots, distributes membership updates, responds to pings, and forwards peer messages.
- `PUT/GET/DELETE /api/orca/keyframes/<code>/<id>`: transfers encrypted snapshots for drop-in players. The emulator compresses and encrypts them; the service stores opaque bytes. Only the host may upload, and room members may retrieve them.
- Optional ICE configuration in the ticket lets the imported libjuice client establish authenticated direct UDP links. Signaling travels through the WebSocket room, and the relay continues as a fallback.

The compatibility key includes the build identity, profile and patch files, forced emulator settings, launcher/SD hashes, save state identity and the disc fingerprint supplied by the launcher. Different keys are refused before sharing inputs.

Production standalone clients use `ORCA_SERVER` and optionally `ORCA_RELAY_KEY`. The process launcher removes inherited `YOUGAME_*`, `ORCA_*` and `YG_*` values before setting its own environment. Existing Orca builds can exercise the private-room protocol using their existing test endpoint override, which was used for the first integration test. The compiled fork uses its new standalone setting.

## Automatic pairing

`ORCA_QUEUE=casual` asks the independent ticket endpoint to choose a room. A first player becomes a waiting host; the next client with the same game mode and compatibility key gets that host's room and a joining role. The normal drop-in machinery then synchronizes the game. This is basic anonymous pairing, not Slippi's service or YouGame's matchmaking population, ranking, account or rating system.

## Launcher and controller input

The browser UI runs on loopback with an unguessable per-process request token. It configures local paths, launches an emulator window, chooses friend rooms or automatic pairing, and stops the game. File paths are passed using `spawn` arguments rather than shell commands. Disc images and mod assets are excluded from Git.

Keyboard and SDL controllers use the imported mappings. The additional `ORCA_ADAPTER=1` option reads a physical GameCube adapter directly through Dolphin's existing libusb code and turns it into the local wire input. The emulated SI devices retain the same ordinary controller type on both machines, so a physical adapter does not change the emulated hardware's compatibility.

## Relationship to Slippi

The supplied [Slippi Launcher repository](https://github.com/project-slippi/slippi-launcher) manages emulator installations, launching, settings and replay features. The Melee rollback engine lives in Slippi's Dolphin/game integration, not in the launcher. Copying that launcher alone would not give Project+ rollback.

This fork uses Slippi's general player experience as a reference: bring a disc, launch the mod, connect to a friend or find an opponent, and play with rollback. It imports Orca's existing Brawl/Project+ implementation rather than trying to transplant Melee-specific patches. Rankings, replay recording/playback and complete Slippi launcher parity remain outside the implemented standalone service.
