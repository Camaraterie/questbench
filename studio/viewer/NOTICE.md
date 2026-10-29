# Observer renderer provenance

QuestBench's observer uses [Max Bittker's rs-world](https://github.com/MaxBittker/rs-world) at
`7e4c9f711ba2f5a1f8e354c6083b8a471530383b`, which credits dennisdev/rs-map-viewer. Preserve the
included BSD-2-Clause notice in `rs-world-LICENSE.txt`.

`rs-world.patch` is copied from [palanti-rs-sdk](https://git.cafe/rs-sdk/palanti-rs-sdk) at
`301e70a9d1e0a491f11bfd6d2e4f3b00dd91d9a1`. It supplies the live renderer, camera controls and
embedding bridge. The reference derives from RS-SDK by Max Bittker and LostCityRS/Server.
Its MIT notice is preserved in `palanti-LICENSE.txt`.

QuestBench's `configure.py` adapts the feed to the same-origin local Studio relay and adds
`SnapshotMotion.ts`, a visual interpolator for sampled positions. No public gameplay feed is used.
The economy, assistant and mission execution systems from Palanti are not included.

Dependencies keep their own licenses. Game cache assets are downloaded locally into ignored
`vendor/`; neither software license asserts rights to redistribute those game assets.
