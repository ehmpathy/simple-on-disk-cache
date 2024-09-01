# Changelog

## [1.5.0](https://github.com/ehmpathy/simple-on-disk-cache/compare/v1.4.0...v1.5.0) (2024-09-01)


### Features

* **perf:** prevent redundant disk.reads via memory cache for perfboost ([f13539a](https://github.com/ehmpathy/simple-on-disk-cache/commit/f13539a2ac50ffb191dd68d559f3bbfdb0c4cbcf))

## [1.4.0](https://github.com/ehmpathy/simple-on-disk-cache/compare/v1.3.4...v1.4.0) (2024-06-26)


### Features

* **config:** enable async getter for directory def ([5040c8b](https://github.com/ehmpathy/simple-on-disk-cache/commit/5040c8b762e1e26bf57e0232d7b57e0d97ef4dc9))

## [1.3.4](https://github.com/ehmpathy/simple-on-disk-cache/compare/v1.3.3...v1.3.4) (2024-06-26)


### Bug Fixes

* **cicd:** enable publish post creds req ([0c579b0](https://github.com/ehmpathy/simple-on-disk-cache/commit/0c579b0fcf79d23d2d0b9c17fd3ad600e0be9b19))

## [1.3.3](https://github.com/ehmpathy/simple-on-disk-cache/compare/v1.3.2...v1.3.3) (2024-06-26)


### Bug Fixes

* **practs:** upgrade to latest best ([#13](https://github.com/ehmpathy/simple-on-disk-cache/issues/13)) ([63a10cd](https://github.com/ehmpathy/simple-on-disk-cache/commit/63a10cd236e6b4ad762e956f513cc8420a3ff276))
* **tests:** enable s3 cicd tests ([#12](https://github.com/ehmpathy/simple-on-disk-cache/issues/12)) ([6015abd](https://github.com/ehmpathy/simple-on-disk-cache/commit/6015abdea51c5a03451d0e689152d7408e2ef456))

### [1.3.2](https://www.github.com/ehmpathy/simple-on-disk-cache/compare/v1.3.1...v1.3.2) (2024-01-07)


### Bug Fixes

* **dirs:** mkdir when creating cache to prevent errors ([b3f00fa](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/b3f00fa296a38d2d851efb36aa372de8600fad6d))

### [1.3.1](https://www.github.com/ehmpathy/simple-on-disk-cache/compare/v1.3.0...v1.3.1) (2022-11-25)


### Bug Fixes

* **keys:** decrease chance of corrupted keyfiles w/ max concurrency limit on keyfile updates ([1671c8e](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/1671c8ec03d88e214927c67dcfc65ca5d81f1f96))

## [1.3.0](https://www.github.com/ehmpathy/simple-on-disk-cache/compare/v1.2.1...v1.3.0) (2022-11-25)


### Features

* **resiliance:** automatically recover from malformed cache files; just warn and move on ([9bb3569](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/9bb35692413b59dce3438926a2b5b377c3e44573))

### [1.2.1](https://www.github.com/ehmpathy/simple-on-disk-cache/compare/v1.2.0...v1.2.1) (2022-11-24)


### Bug Fixes

* **cicd:** use node v16 in gh actions ([e341fea](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/e341fea2545ecb5b88d04946aa4060fe5759d4e3))
* **deps:** fix dep versions to ensure its buildable on cicd ([fba09f4](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/fba09f4528b121e3f39ec418a3d186dffd5ca937))
* **tests:** use fs.unlink instead of fs.rm ([392f410](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/392f410f6f0a3e20133516a8647b2609e2a9f707))

## [1.2.0](https://www.github.com/ehmpathy/simple-on-disk-cache/compare/v1.1.1...v1.2.0) (2022-11-24)


### Features

* **keys:** enable accurate retrieval of active valid cache keys ([3558572](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/355857284a832115bf2657eb9a08cbe00e3e6d7b))

### [1.1.1](https://www.github.com/ehmpathy/simple-on-disk-cache/compare/v1.1.0...v1.1.1) (2022-11-22)


### Bug Fixes

* **tests:** add proof that errors attempted to be set are handled correctly ([ae06132](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/ae0613254efd4a9bbe9a81e310ed15b1a453d8be))
* **types:** expose a type for an instance of the cache ([a21fc63](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/a21fc63819e1dbbc45b5decdf80fa323847bffbb))

## [1.1.0](https://www.github.com/ehmpathy/simple-on-disk-cache/compare/v1.0.1...v1.1.0) (2022-10-09)


### Features

* **obs:** save value to cache file as observably as possible ([11204fe](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/11204febf46fbc3d3b5a4d1bc99dff2c5673230a))

### [1.0.1](https://www.github.com/ehmpathy/simple-on-disk-cache/compare/v1.0.0...v1.0.1) (2022-10-09)


### Bug Fixes

* **pkg:** fix the package description and keywords ([ddfad25](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/ddfad255f31cb8d91035a7cfb1bc70546859c1ee))

## 1.0.0 (2022-10-09)


### Features

* **init:** publish as standalone package ([cee9740](https://www.github.com/ehmpathy/simple-on-disk-cache/commit/cee9740800bc8e138346f0c91f5919cf65b2ec4d))
