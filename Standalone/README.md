# Project+ Standalone Rollback

This branch ports Orca 0.3.28 into the Project+ Dolphin `2609-merge` branch, and adds an independent launcher and room service. It runs the official Project+ v3.2 Netplay launcher on your own Brawl USA Rev 2 disc. Your ISO is read in place. Project+ assets are checked by Orca's pinned profile and stay separate from the disc.

The service supports private rooms, automatic casual pairing, input relaying, ICE signaling for direct UDP links, and encrypted keyframe uploads for joining an existing game. It uses no YouGame account, app, API, cookie or service. Both clients must use this same build and matching game files.

## Run on Windows

1. Install Node.js 22 or newer. Build the emulator using `build-windows.ps1` (Visual Studio 2026 with C++ tools and CMake), or use a packaged build of this branch.
2. Run `Standalone/start.ps1`. The launcher opens at `http://127.0.0.1:4317` and a local relay runs on port 4318.
3. Enter the emulator path, your own Brawl image, and `Project+ Netplay Launcher.dol`. `sd.raw` must be beside the launcher. Existing installed YouGame files are detected for convenience, but they are not required. Download the official v3.2 Netplay release from [Project+](https://projectplusgame.com/download) if you need the assets.
4. Use **Offline play**, **Host a room**, **Join friend**, or **Find a match**. Find a match pairs two compatible players on the chosen relay, with the second dropping into the first player's running game. Select characters and play in Versus. Stop cancels waiting as well as playing.

The first launch hashes the full disc for compatibility; later launches reuse the hash while the file's metadata is unchanged. Compressed images use `dolphin-tool verify` to hash their decompressed contents; the tool must sit beside the emulator. Loader and SD hashes are verified by the emulator every boot. Game assets and disc images are never committed or uploaded by this launcher.

If the installed MSVC compiler is below the upstream minimum, `build-clang.py` builds with a portable LLVM toolchain and the existing Windows SDK. It requires Python and takes `--llvm <LLVM folder>` and `--vs <Visual Studio folder>`. The build uses `clang-cl` and Ninja, preserves the MSVC version guard, and disables the shared MSVC PCH for clang-cl. See VALIDATION.md for the toolchain actually exercised.

Default controls are Orca's keyboard and SDL controller mappings. An existing local `GCPadNew.ini` is imported once if available. Your own mapping lives in `Standalone/user/Config/GCPadNew.ini`. The **GameCube USB adapter** checkbox uses physical adapter port 1 directly through Dolphin's libusb driver. The emulated controllers remain identical on both machines. On Windows, the adapter needs the same WinUSB driver as Dolphin/Slippi. Hardware adapter behavior requires testing with an attached controller.

## Play across the internet

The localhost relay is for testing on one computer. Host `Standalone/relay.mjs` on a machine you control and put it behind an HTTPS reverse proxy with WebSocket support. Both players enter that HTTPS origin. Alternatively build the included Dockerfile.

```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '4318'
$env:PUBLIC_URL = 'https://your-relay.example.com'
$env:RELAY_KEY = 'your-private-server-access-key'
npm run relay
```

Enter the same optional access key in each launcher. `PUBLIC_URL` must be the externally reachable HTTPS origin. Request bodies must allow up to 128 MiB for encrypted keyframes; use a proxy timeout of several minutes. The relay stores these briefly in memory and deletes them after transfer/expiry or room teardown. Room codes are invitations and should be shared privately. The service is an initial community relay, with bounded tickets, rooms, state storage, message size and rate; it has no accounts or moderation tools.

ICE uses Orca's existing STUN default and can be configured with `ICE_SERVERS`, a JSON array of `{urls, username?, credential?}` entries. Own STUN/TURN servers may be supplied. The WebSocket relay carries inputs when direct UDP is unavailable. No hosting service has been deployed by this work.

## Verification

```powershell
npm test
node test/emulator-smoke.mjs
```

The emulator smoke test needs your local game paths (auto-detected or saved in `local.json`) and the local relay running. It boots two headless, muted instances, joins through the HTTP keyframe store, injects 55 ms delay each way, plays scripted inputs, checks that both actually roll back, and tests leaving. It writes logs and summaries into ignored `test-output/`. It requires a two-instance-capable machine and takes roughly a minute. Use `STANDALONE_MATCH_TEST=1` to test casual pairing instead of a private room.

The imported C++ test suite covers snapshots, rollback sessions, packets, drop-in and game UI. The exact command and observed results are recorded in [VALIDATION.md](VALIDATION.md).

## Scope

This is an initial standalone implementation. It does not provide Slippi's accounts, public population, rankings, `.slp` recording/playback, or full launcher feature parity. Orca's original menu and ranked code is imported for preservation, but its YouGame-specific queue UI is not wired to the independent service; use the launcher's buttons. The Project+ Qt frontend retains the original delay-based Netplay; rollback uses `ProjectPlusRollback.exe`.

The Windows build is the target validated here. The imported core supports macOS/Linux source builds, but no standalone Mac/Linux package or cross-machine/cross-OS test is claimed. No online service can supply opponents until people choose and run a common server.

## Source and credits

- Project+ Dolphin base: `Project-Plus-Development-Team/Project-Plus-Dolphin`, `2609-merge`, commit `b41d028ded5aad51bfa663449937e11a5668a2be`.
- Orca source: `Lrosias/orca-netplay`, `orca-0.3.28`, commit `e41498cf2b74ae398a76b7f69216cf5a7692f730`.
- Orca's changes were applied as the diff against its Dolphin 2609 base `f84df02055ab9610feec48e65648cac5a3c098fa`, preserving Project+ changes through three-way merging.
- [ORCA_ARCHITECTURE.md](../ORCA_ARCHITECTURE.md) and [ORCA.md](../ORCA.md) preserve upstream design notes and attribution. Brawlback's contribution is credited there and in the source.
- [Slippi Launcher](https://github.com/project-slippi/slippi-launcher) was examined as a product reference. No Slippi launcher or Melee-specific patches were copied.

The existing license and attribution notices remain. New standalone files use GPL-2.0-or-later; see the repository's COPYING and LICENSES for aggregate licensing. This is an unofficial fork, unaffiliated with the Project+ team, Dolphin, Slippi, Brawlback or YouGame.
