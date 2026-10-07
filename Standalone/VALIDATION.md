# Validation — 2026-10-06

Local Windows x64 validation of the standalone Project+ rollback fork. The compiled emulator reports source revision `6b12611`. The final launcher/service scripts additionally include the fixed-delay handshake and updated disc-tool filename lookup. Original upstream claims are not substituted for the results below.

## Build

- `ProjectPlusRollback.exe`, `DolphinTool.exe`, and `Tests/tests.exe` compiled and linked successfully.
- LLVM clang-cl 23.1.3, Ninja, the existing Visual Studio 2026 headers/libraries, and Windows SDK 10.0.26100.0.
- The installed MSVC 19.51.36244 was below upstream's required patch version. Its version guard was preserved; a workspace-local LLVM compiler was used instead.
- The portable clang build retains warnings as diagnostics instead of treating every new clang Windows diagnostic as a build error. The default MSVC build still treats warnings as errors.
- Shared MSVC PCH was disabled for clang-cl. Portability fixes cover explicit header dependencies, function target attributes, Windows macro collisions, supported linker flags, and several safe conversions/initializers.

SHA-256 of the packaged emulator:

```text
4cecb8b9b1d015de0eeccdbe32c3bf69738559d3e17ed232e627a1bbfa5a6d1f
```

## C++ suite

```powershell
Binary/x64/Tests/tests.exe --gtest_filter=Orca*:*Rollback*:*SHA1*:*AES*:*Jit*:*PageTable* --gtest_output=xml:Standalone/test-output/cpp-tests.xml
```

524 passed, 18 skipped, zero failures; 542 tests across 72 suites. Skips include YouGame live-service tests and optional disc/font/demo cases. These tests were deliberately not allowed to contact YouGame. The independent service was tested separately below.

## Exact replay comparison

`test/sync-test.mjs` booted the actual Project+ v3.2 loader and SD image with the user's Brawl USA Rev 2 disc. It reached `scMelee`, ran 2,400 first-pass frames, and repeatedly rewound five frames:

```text
10475 re-run frames checked
0 RAM mismatches (PASS)
2096 loads
```

The upstream harness also reported 10,475 device-state-only mismatches. Upstream documents these as expected host bookkeeping/cache differences and uses RAM mismatches as its pass criterion. This result proves exact RAM replay for the exercised run, not that every serialized host-side field is byte-identical.

## Independent matchmaking and rollback

Two compiled fork instances ran against `Standalone/relay.mjs` on loopback using Node 22.23.3 and ws 8.22.0. They used `ORCA_SERVER`, with the legacy `ORCA_SITE` and `ORCA_TEST_DEV_GAME` values removed. `ORCA_QUEUE=casual` automatically assigned a shared room and host/join roles.

The guest downloaded an approximately 23.1 MB encrypted/compressed keyframe through the independent HTTP store, caught up, and plugged into the host's game. Both reached character select, stage select and an actual match. With 55 ms artificial delay each way, fixed two-frame input delay, and the direct path disabled to exercise the relay:

| Result | Host | Guest |
|---|---:|---:|
| Observed seconds with peer | 35 | 35 |
| Rollbacks in those samples | 134 | 142 |
| Replayed frames in those samples | 740 | 767 |
| Latest sampled delay | 2 | 2 |
| Latest sampled desync count | 0 | 0 |

At leave, both logs reported 37 matching checksums. The guest left at an agreed frame and both returned to solo play. The script exited successfully. This is functional local integration coverage with simulated latency; it is not a cross-internet benchmark or a guarantee of performance on other hardware.

An earlier private-room integration test against the unchanged installed Orca also passed, validating the independent room and state-store protocol before the fork was compiled.

## Launcher and dependencies

- Three Node tests pass: credential/test-environment stripping and safe argument construction; ticket/room/state-store behavior including incompatible-key and cross-room rejection; compatible-only automatic pairing.
- `npm audit --omit=dev` reports zero known vulnerabilities in the launcher/service dependency set.
- Current portable Node 22.23.3 was downloaded from nodejs.org and checked against its official SHA-256 manifest.
- Browser UI verified detected paths, settings save, offline launch, and stop. The local package includes its own emulator, Node runtime, controller mapping, and copied Project+ loader/SD assets; the ISO is referenced in place.

## Not validated or implemented

No cross-machine, internet, macOS/Linux, physical GameCube-adapter, NAT traversal or TURN deployment test was performed. The imported direct-link implementation and added adapter path are present but require those tests. No public relay was deployed. Ranked accounts/ratings, Slippi replay recording/playback and full Slippi feature parity are not implemented. The standalone launcher drives its own room/pairing buttons; the inherited YouGame-specific in-game queue is not connected to this service.
