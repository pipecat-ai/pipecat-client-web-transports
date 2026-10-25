# Changelog

## [0.2.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/transport-lib-v0.2.0...transport-lib-v0.2.1) (2026-10-25)

### Changed

* `@pipecat-ai/transport-lib` now requires `@pipecat-ai/client-js` `~1.15.0` as a peer dependency. Upgrade `@pipecat-ai/client-js` to 1.15.x alongside this release. ([d2a5122](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/d2a51222639c6013e1202d74a6abea17204b41df))

## [0.2.0](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/transport-lib-v0.1.1...transport-lib-v0.2.0) (2026-10-16)

### Features

* report media support from each transport ([33dff50](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/33dff50eff8231ecd708e90a10a38104b25b5e0e))
* **transport-lib:** add mediaSupport to media managers ([55412ff](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/55412ffd8990142c20eddbee60146380001f01b6))

### Bug Fixes

* **transport-lib:** credit OpenAI's MIT license in wavtools ([6c2906f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6c2906f6c4e49dfe11202d4f335e661ae598c850))
* **transport-lib:** credit OpenAI's MIT license in wavtools ([9d5e553](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/9d5e553561536a935c297b5bbbafb6a92e6c2af8))
* **transport-lib:** only claim screen share where the browser supports it ([d69d37b](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/d69d37b38e6b9be66091dc578e43eb11d00ce126))

### Other

* Bumped the `@pipecat-ai/client-js` peer dependency to `~1.14.0`. Projects using `@pipecat-ai/transport-lib` should upgrade `@pipecat-ai/client-js` to 1.14.x. ([6f1bf1a](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/6f1bf1a37e7077e54e27a92b810c1e146be781fe))
* `@pipecat-ai/transport-lib` now depends on `@daily-co/daily-js` `^0.94.0` (previously `^0.90.0`). `DailyMediaManager` uses this version. ([1ffa4f8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/1ffa4f87edd988bf289768877c16c6d4dd37567d))

## [0.1.1](https://github.com/pipecat-ai/pipecat-client-web-transports/compare/transport-lib-v0.1.0...transport-lib-v0.1.1) (2026-09-15)


### Bug Fixes

* Fix issue where the DailyMediaManager would not resolve in conne… ([9f7a953](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/9f7a95350753dc75985ce2225495b3ca06a3bbcf))
* Fix issue where the DailyMediaManager.connect() would not resolve on second call ([dc935d3](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/dc935d3ad1ce76c401b24fc35ae338e3175fef07))
* Fix param types causing build warnings ([10635bf](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/10635bf0794502b5a2d9c33e7497f892cd1c4bd0))
* Fix param types causing build warnings ([efc3f45](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/efc3f45c46cbf05dfade3e48dc42924c43690460))
* Fixed issue with mute toggle states being delayed ([a4051c8](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/a4051c87d4aae2d1007e56400848d6f1efd34455))
* Fixed issue with mute toggle states being delayed ([51954df](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/51954df18f7f1f23b6965e863ac0425493f9be4d))
* The dailyMediaManager should use daily for speaker selection ([2ef388f](https://github.com/pipecat-ai/pipecat-client-web-transports/commit/2ef388fdbeefb004b330d81071928fbe5aaa7c30))
