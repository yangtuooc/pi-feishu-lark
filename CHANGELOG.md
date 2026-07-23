# Changelog

## [0.4.14](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.13...v0.4.14) (2026-07-23)


### Features

* configurable ignoreBotMessages for bot-origin messages ([#26](https://github.com/yangtuooc/pi-feishu-lark/issues/26)) ([2b2c806](https://github.com/yangtuooc/pi-feishu-lark/commit/2b2c80688f0042cee25c9ae5651fed83026fa6e1))

## [0.4.13](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.12...v0.4.13) (2026-07-23)


### Features

* groupKeywords match interactive card text ([#23](https://github.com/yangtuooc/pi-feishu-lark/issues/23)) ([b0704f6](https://github.com/yangtuooc/pi-feishu-lark/commit/b0704f62f7aec090aa625514430377f5d4bff901)), closes [#22](https://github.com/yangtuooc/pi-feishu-lark/issues/22)

## [0.4.12](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.11...v0.4.12) (2026-07-22)


### Bug Fixes

* clarify feishu_config_set is hot-reload, no restart ([e7d6a65](https://github.com/yangtuooc/pi-feishu-lark/commit/e7d6a65742d9955e8ce9bbadce624bab0c60ae08))
* feishu_config_set guidance — hot-reload, never restart ([c8c64bf](https://github.com/yangtuooc/pi-feishu-lark/commit/c8c64bffa142ae2fb872da00b612259e2f2fbf66))

## [0.4.11](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.10...v0.4.11) (2026-07-22)


### Features

* group keyword + alsoOnReply triggers (P0) ([ae1d6fd](https://github.com/yangtuooc/pi-feishu-lark/commit/ae1d6fd009c96a0c625b00e9be01f55d9abe91d5))
* group keyword + alsoOnReply triggers (P0) ([6876653](https://github.com/yangtuooc/pi-feishu-lark/commit/6876653e3e41c4e74741b1391f014e6e02c213fd)), closes [#14](https://github.com/yangtuooc/pi-feishu-lark/issues/14)
* runtime config via /config and agent tools ([8c1f474](https://github.com/yangtuooc/pi-feishu-lark/commit/8c1f4745365e86af210b0cd8b1e28c18ae862bc4))
* runtime config via /config and agent tools ([17b4682](https://github.com/yangtuooc/pi-feishu-lark/commit/17b4682ace05fb06a07058e3f917d71b4a2d8920))

## [0.4.10](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.9...v0.4.10) (2026-07-22)


### Bug Fixes

* return schema 2.0 card on stop callback for CardKit stream ([#12](https://github.com/yangtuooc/pi-feishu-lark/issues/12)) ([9b4b9b0](https://github.com/yangtuooc/pi-feishu-lark/commit/9b4b9b095969e39538547ad1d734dffe719e2ab2))

## [0.4.9](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.8...v0.4.9) (2026-07-21)


### Bug Fixes

* restore stop button on CardKit streaming cards ([18810b3](https://github.com/yangtuooc/pi-feishu-lark/commit/18810b36b58dcad67371b75c7fd15e3cbe8bc5d8))
* restore stop button on CardKit streaming cards ([be47dfe](https://github.com/yangtuooc/pi-feishu-lark/commit/be47dfea88be8cb41852a4e4ebc18cb921ffe2ae))

## [0.4.8](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.7...v0.4.8) (2026-07-21)


### Bug Fixes

* update CardKit header after stream completes ([759e55d](https://github.com/yangtuooc/pi-feishu-lark/commit/759e55d6ec7ef490f873a33a52e09def6e4e801d))
* update CardKit header to 回复 after stream completes ([3be7548](https://github.com/yangtuooc/pi-feishu-lark/commit/3be75486a32f0049d07aeaf84ac92722e48cfde5))

## [0.4.7](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.6...v0.4.7) (2026-07-21)


### Features

* use Feishu CardKit streaming for soft character print ([2685a4c](https://github.com/yangtuooc/pi-feishu-lark/commit/2685a4c90b56b4dc372c5ebf8b3b3d1cff84ef24))

## [0.4.6](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.5...v0.4.6) (2026-07-21)


### Bug Fixes

* coalesce stream patches for smoother card updates ([25dff1a](https://github.com/yangtuooc/pi-feishu-lark/commit/25dff1a32e843f20c46909e21dd7b6c581b1766a))

## [0.4.5](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.4...v0.4.5) (2026-07-20)


### Bug Fixes

* restore streaming via session-level text_delta path ([c1c479f](https://github.com/yangtuooc/pi-feishu-lark/commit/c1c479f962e123efa2f15a7d931dcaa8ca9d6037))

## [0.4.4](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.3...v0.4.4) (2026-07-20)


### Features

* configurable smoother reply streaming ([2f0699d](https://github.com/yangtuooc/pi-feishu-lark/commit/2f0699de38dfe65d2ba7d1d65b6f9a6f66f09a15))

## [0.4.3](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.2...v0.4.3) (2026-07-20)


### Bug Fixes

* use Get reaction and stream final reply text ([38fddd4](https://github.com/yangtuooc/pi-feishu-lark/commit/38fddd4237ab4b2a8a6f63a4db36dcc780db1a49))

## [0.4.2](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.1...v0.4.2) (2026-07-20)


### Bug Fixes

* show only final user reply on unified card ([8012651](https://github.com/yangtuooc/pi-feishu-lark/commit/8012651712df4dc14de77cd4613e7e64a2b12f34))

## [0.4.1](https://github.com/yangtuooc/pi-feishu-lark/compare/v0.4.0...v0.4.1) (2026-07-20)


### Features

* unified reply card with persistent header ([eced985](https://github.com/yangtuooc/pi-feishu-lark/commit/eced9859be76ce245fb80f428b646b52f1c2c536))
