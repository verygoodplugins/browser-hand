# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0](https://github.com/verygoodplugins/browser-hand/compare/browser-hand-v0.3.0...browser-hand-v0.4.0) (2026-11-11)


### Features

* add --ignore-https-errors flag for self-signed certs ([#79](https://github.com/verygoodplugins/browser-hand/issues/79)) ([1a66133](https://github.com/verygoodplugins/browser-hand/commit/1a66133d56c1f7c7bd725e100ebdbfdc37bdf9b8))
* add page.cua (vision) and page.domCua (DOM-id) toolsets ([#114](https://github.com/verygoodplugins/browser-hand/issues/114)) ([a2cbafb](https://github.com/verygoodplugins/browser-hand/commit/a2cbafb7ebcce7676af34e210fbfe992d79f1761))
* add Windows x64 support and npm packaging ([#66](https://github.com/verygoodplugins/browser-hand/issues/66)) ([0817e87](https://github.com/verygoodplugins/browser-hand/commit/0817e87dcbf713fce8e40b8c4cf40f8dbd71c12e))
* **brand:** add ghost-glove identity, GitHub banner, and toolbar icons ([61a5d55](https://github.com/verygoodplugins/browser-hand/commit/61a5d553efd73949504061a5b32749e4e63beabc))
* **brand:** add ghost-glove identity, GitHub banner, and toolbar icons ([f4b07ad](https://github.com/verygoodplugins/browser-hand/commit/f4b07adc81100b02019bdb134b8bac61fbfd0b4e))
* **brand:** crop mist out of the toolbar glove ([90f38d4](https://github.com/verygoodplugins/browser-hand/commit/90f38d4dca3fab6bd642740d6972d58db4322426))
* **brand:** crop mist out of the toolbar glove ([745e109](https://github.com/verygoodplugins/browser-hand/commit/745e1097ec0c95442c72dd0285562f634fb6e3fe))
* clean up idle managed browsers ([#124](https://github.com/verygoodplugins/browser-hand/issues/124)) ([0038e98](https://github.com/verygoodplugins/browser-hand/commit/0038e984e002dfcbff2e14ba497d69cdfe549102))
* **cli:** add `close` to shut tabs Browser Hand opened ([422306e](https://github.com/verygoodplugins/browser-hand/commit/422306efef976460662e80432d47adc1c9f9166a))
* **cli:** add `close` to shut tabs Browser Hand opened ([dc457ee](https://github.com/verygoodplugins/browser-hand/commit/dc457ee61b6e6344fb8a58720c3e327fe2fd6c93)), closes [#31](https://github.com/verygoodplugins/browser-hand/issues/31)
* **cli:** add snapshot, doctor, and click contract helpers ([be06af4](https://github.com/verygoodplugins/browser-hand/commit/be06af42364b1240a50f1ca43359ff2f745fe7ef))
* **cli:** add snapshot, doctor, and click contract helpers ([9c3b7c3](https://github.com/verygoodplugins/browser-hand/commit/9c3b7c333eacabc658b578b3c5c358f71f2f966d))
* **cli:** compact JSON stdout and gym compare puppeteer driver ([c40d628](https://github.com/verygoodplugins/browser-hand/commit/c40d6282447a1e0aea74638f3e8e3335ae635810))
* **cli:** compact JSON stdout and gym compare puppeteer driver ([d1b756c](https://github.com/verygoodplugins/browser-hand/commit/d1b756c52c9f768cf3bfbf6fbbf06d93606eb0a2))
* **cli:** launch throwaway browsers from the one connected to the relay ([598b8df](https://github.com/verygoodplugins/browser-hand/commit/598b8df71d68c463339259a140ddc4013261d4df))
* **cli:** launch throwaway browsers from the one connected to the relay ([a8422df](https://github.com/verygoodplugins/browser-hand/commit/a8422dfb997a3efc1e8b03cb9011348eeb5a7f36))
* **cli:** list forms first in snapshots ([9fe71c2](https://github.com/verygoodplugins/browser-hand/commit/9fe71c27952fdd88edfcf334726611c1fe0f8037))
* **cli:** list forms first in snapshots ([c01c162](https://github.com/verygoodplugins/browser-hand/commit/c01c1625a821c095beaad93652e7bd18a0d4aed1))
* **cli:** pass an optional tab group title ([d2b067e](https://github.com/verygoodplugins/browser-hand/commit/d2b067e585e77a96a6f8d0679f1561e9d3fca7da))
* **cli:** pass an optional tab group title ([b31451a](https://github.com/verygoodplugins/browser-hand/commit/b31451a3aeb557d825eac3828636611a45dd100a))
* **cli:** run a form as one steps call ([d05e11a](https://github.com/verygoodplugins/browser-hand/commit/d05e11a03de666c27f902f2c0f68b05fcfc9dfeb))
* **cli:** run a form as one steps call ([cc485a5](https://github.com/verygoodplugins/browser-hand/commit/cc485a50a385f21c6e54cdd889628ac5d90ff981))
* **cli:** wire scoped snapshot, compact doctor, and click handles ([6eedb0e](https://github.com/verygoodplugins/browser-hand/commit/6eedb0eeb70849556683952bd020e0a5241a1ecf))
* **cli:** wire scoped snapshot, compact doctor, and click handles ([7bf51ab](https://github.com/verygoodplugins/browser-hand/commit/7bf51ab818ac13efd6da76f659d557e6e3f2d04a))
* dev-browser CLI ([9ddbc13](https://github.com/verygoodplugins/browser-hand/commit/9ddbc132a6bcbad154d0782721f8598a947e6ddd))
* **extension:** add an optional titled tab group ([2b44893](https://github.com/verygoodplugins/browser-hand/commit/2b448936bf730a6fdcb71ba249ac6bb82553f044))
* **extension:** add an optional titled tab group ([86ce655](https://github.com/verygoodplugins/browser-hand/commit/86ce655d37cb01387a369dc0953e046b20331aaf))
* **extension:** debugger-free page control so Browser Hand works in Search ([682f6bf](https://github.com/verygoodplugins/browser-hand/commit/682f6bf8b4c50c8be818815dbfda18483a4a4284))
* **extension:** debugger-free page control so Browser Hand works in Search ([3603bf6](https://github.com/verygoodplugins/browser-hand/commit/3603bf602be494347ebb90a632b413f0fb5b7e62))
* **gym:** add vanilla Playwright as a benchmark-only compare driver ([477e197](https://github.com/verygoodplugins/browser-hand/commit/477e197f05f841269056483b92df64f461b43ef6))
* **gym:** add vanilla Playwright as a benchmark-only compare driver ([b527514](https://github.com/verygoodplugins/browser-hand/commit/b52751437f0cf929ef991198668b6d515ca4e1f4))
* rebrand as Browser Hand and land Path A extension ([01d83f7](https://github.com/verygoodplugins/browser-hand/commit/01d83f7ec0e418fa034c79dd8f3cb354cb93e0c8))
* self-contained Path A stack (CLI + relay + skill + live smoke) ([874de65](https://github.com/verygoodplugins/browser-hand/commit/874de6543e009044e6d1cf71790a249ab6d01af1))
* target the connected browser, not Chrome by default ([#29](https://github.com/verygoodplugins/browser-hand/issues/29)) ([#30](https://github.com/verygoodplugins/browser-hand/issues/30)) ([7b02d50](https://github.com/verygoodplugins/browser-hand/commit/7b02d50c749f01e8480e1eb861ce9fbc0d646187))


### Bug Fixes

* add install lock to prevent concurrent npm install corruption ([#76](https://github.com/verygoodplugins/browser-hand/issues/76)) ([f9ee211](https://github.com/verygoodplugins/browser-hand/commit/f9ee2114571980239d7e57540ee86b82fa6515ed))
* bound browser requests and streamline agent actions ([#118](https://github.com/verygoodplugins/browser-hand/issues/118)) ([a5ecfca](https://github.com/verygoodplugins/browser-hand/commit/a5ecfca5f077a5d2d7f1978110d6bb4fe392a98c))
* bound listPages title lookup ([#72](https://github.com/verygoodplugins/browser-hand/issues/72)) ([ea752ba](https://github.com/verygoodplugins/browser-hand/commit/ea752ba03f503aecfc01922f92c8b115377db6a6))
* **brand:** clear mist pixels inside the glove crop ([be39dc4](https://github.com/verygoodplugins/browser-hand/commit/be39dc410e3b9b07605bc822ee434578f68a0a35))
* **brand:** clear only the plume under the wrist ([1e97b11](https://github.com/verygoodplugins/browser-hand/commit/1e97b115c1a267a6772fe0ac74885c89c5ea1af8))
* **brand:** crop the toolbar glove to the solid bone ([5db5b97](https://github.com/verygoodplugins/browser-hand/commit/5db5b97c81c39c7664f89539dc7546b373aa5e60))
* build daemon bundles before Rust compilation in release workflow ([80880ab](https://github.com/verygoodplugins/browser-hand/commit/80880ab0c4788bc68eab07b6162cdbdb75687735))
* **cli:** accept a closed combobox that holds the requested value ([2fc7ea3](https://github.com/verygoodplugins/browser-hand/commit/2fc7ea3add44657ea66720c37639716e36093047))
* **cli:** accept a committed non-ASCII combobox value ([ba956af](https://github.com/verygoodplugins/browser-hand/commit/ba956afbdd248df3c7c1323a8727c6fa061b9151))
* **cli:** adopt only a unique exact URL and drop stale tab ids ([89e3c3b](https://github.com/verygoodplugins/browser-hand/commit/89e3c3be50571549f9229d4d4ac6610da3727a35))
* **cli:** attach to an existing named page on click/type, never create one ([068f2e1](https://github.com/verygoodplugins/browser-hand/commit/068f2e1ab62eee94b1d93bc2c0b29c1b06235677))
* **cli:** await scripting eval and assign date values atomically ([d022a72](https://github.com/verygoodplugins/browser-hand/commit/d022a726916b68754c094432ee9e9f06200de03c))
* **cli:** bound steps and keep snapshot and evaluate data ([c654c4b](https://github.com/verygoodplugins/browser-hand/commit/c654c4b34c336710e904f3ab3a25e315c0ff180e))
* **cli:** cap combobox typing delay under the relay timeout ([f5440a6](https://github.com/verygoodplugins/browser-hand/commit/f5440a60cd6917959edc46fb58367a424ef4bfa1))
* **cli:** cap snapshot forms and skip hidden iframes ([c0f862a](https://github.com/verygoodplugins/browser-hand/commit/c0f862a6d3a363a299ecbe729b75b9091dc160d0))
* **cli:** clip inventory only and honor target.name on tabs ([e662137](https://github.com/verygoodplugins/browser-hand/commit/e662137a8826597501f8ad95a40aa2372ec8689c))
* **cli:** compare select options and text writes exactly ([948efa8](https://github.com/verygoodplugins/browser-hand/commit/948efa8ae47b8f05caffe9dede7a266929c8fe2e))
* **cli:** confine the label-read mutation, cancel interrupted pointers, recheck disabled ([bf3ff1b](https://github.com/verygoodplugins/browser-hand/commit/bf3ff1b30fc42a05146eb28ef4c999b4f037436a))
* **cli:** correct the shadow-form test to match native association ([953ac73](https://github.com/verygoodplugins/browser-hand/commit/953ac73b4133eac5760af13ee1b3d78ffaa145a9))
* **cli:** disabled controls, occluded ranking, repeated aria-hidden text ([fc63adc](https://github.com/verygoodplugins/browser-hand/commit/fc63adc5c166f7eb7e8b9fd2ee0f339c9e2d8589))
* **cli:** do not attach a control whose form id is missing ([3dd75c6](https://github.com/verygoodplugins/browser-hand/commit/3dd75c6907e3ca2bc114d880e3a1be80ed5483cb))
* **cli:** do not bind a shadow field to a light-DOM form id ([a32623d](https://github.com/verygoodplugins/browser-hand/commit/a32623d67c8c1ca48b75bca85b231c3030cba09f))
* **cli:** do not fill a field that only shares a word ([776c167](https://github.com/verygoodplugins/browser-hand/commit/776c167df718fdb1587e21ba6b931a51e8dded56))
* **cli:** do not reload a tab that was just opened at its URL ([1bfaf2d](https://github.com/verygoodplugins/browser-hand/commit/1bfaf2d546e4f57348ff0d9d8baccced67ad4aec))
* **cli:** drop mouseMoved, reject stale targets, clamp the settle knob ([e890a7b](https://github.com/verygoodplugins/browser-hand/commit/e890a7bdfe4b83432c66f3e9762a107e375d1ad5))
* **cli:** exclude aria-hidden by hiding and re-reading; stop a click mid-sequence ([1eaad04](https://github.com/verygoodplugins/browser-hand/commit/1eaad040affff4f69ba541b50fd59a38d6e7991a))
* **cli:** fail autofill when a written field does not stick ([96bd834](https://github.com/verygoodplugins/browser-hand/commit/96bd83471a6e675875e0f3e89a8dbb38d4d9bd09))
* **cli:** fail combobox fill unless a scoped option is selected ([812c94f](https://github.com/verygoodplugins/browser-hand/commit/812c94f3356ac3196f777f130140e93ad6fd2147))
* **cli:** fail fill when a field misses ([1397aa0](https://github.com/verygoodplugins/browser-hand/commit/1397aa01832c4f8d12d7fb7a58e11b7e793f487f))
* **cli:** fail fill when a field misses ([e8103ae](https://github.com/verygoodplugins/browser-hand/commit/e8103aee94823b7570a6fa2852f743c180ffc5c4))
* **cli:** group an existing tab when goto sets a title ([792a7b1](https://github.com/verygoodplugins/browser-hand/commit/792a7b13e7a20b21509481558daef21e6c8e6600))
* **cli:** honor --target-id on tabs and stop over-claiming last-focused ([2c1deb0](https://github.com/verygoodplugins/browser-hand/commit/2c1deb0a038d2ddacee3677cea5b593cfe66d073))
* **cli:** include shadow and iframe fields in snapshot forms ([7a7cd43](https://github.com/verygoodplugins/browser-hand/commit/7a7cd43c759d5d2b48a2591df802dcd69b3610c8))
* **cli:** keep a non-matching app alias from hiding the real bundle ([7894c28](https://github.com/verygoodplugins/browser-hand/commit/7894c2895ddc9a0aed625ca3cabe41073a239c13))
* **cli:** keep formatted secrets out of step snapshots ([ac0ffdd](https://github.com/verygoodplugins/browser-hand/commit/ac0ffdd43d7a2fb958397cf6fbd1118752d64558))
* **cli:** keep label-chaos matches and honest combobox readback ([e06d9a5](https://github.com/verygoodplugins/browser-hand/commit/e06d9a5af37ddb4110570f31bfd3f92e3435ecf9))
* **cli:** keep named goto as create-or-reuse ([5f7eb47](https://github.com/verygoodplugins/browser-hand/commit/5f7eb477aeeee31a929122efc7ea139a091c875b))
* **cli:** keep nav shadows out and name range inputs ([480756d](https://github.com/verygoodplugins/browser-hand/commit/480756da418b3480c9c51f71740cfddb24d2ef3d))
* **cli:** keep shadow labels and form-associated controls together ([b6c9c93](https://github.com/verygoodplugins/browser-hand/commit/b6c9c9334e7dd3a60f074ce548ef545a6cbf7257))
* **cli:** keep snapshot names, refs, and expanded state ([a69da64](https://github.com/verygoodplugins/browser-hand/commit/a69da6457692506e3a7ac3fa1a2f8b77052abb13))
* **cli:** keep snapshot roots and names inside the right tree ([6b11256](https://github.com/verygoodplugins/browser-hand/commit/6b11256b8abb864460ed56fc5ca7e063426d3293))
* **cli:** keep strategy:first in source order ([cdf5cfd](https://github.com/verygoodplugins/browser-hand/commit/cdf5cfdb63440b6365ad860a24862db8f59d24d2))
* **cli:** keep unicode and punctuation in fill read-back ([44d862e](https://github.com/verygoodplugins/browser-hand/commit/44d862ea7d75d98767b88284594d2208f1c2761e))
* **cli:** keep unicode, punctuation, and missing form ids honest ([31fbbca](https://github.com/verygoodplugins/browser-hand/commit/31fbbcaf487c49458859e2fcf721fe04a0782d45))
* **cli:** keep validation alerts in the scoped snapshot ([b6e7e12](https://github.com/verygoodplugins/browser-hand/commit/b6e7e12d2eb1931f97cda27f5b9421beec8250fb))
* **cli:** leave shadow inputs off the outer form ([056d112](https://github.com/verygoodplugins/browser-hand/commit/056d112e056b04d1c7bf2e29fdf6c8971a49bbb2))
* **cli:** let close see about:blank and file:// tabs ([1d06543](https://github.com/verygoodplugins/browser-hand/commit/1d06543cd1a51f90b73dbbf8f0b07abc3dbfd46c))
* **cli:** list every tab and target the last-focused one ([19e91fc](https://github.com/verygoodplugins/browser-hand/commit/19e91fc9ba4af816e15b6aab3436e3efa9aea78d))
* **cli:** list every tab and target the last-focused one ([6808ac6](https://github.com/verygoodplugins/browser-hand/commit/6808ac660809774ff5e7bf788f563365e71916e7))
* **cli:** omit password values from snapshot nodes ([8b3e0c0](https://github.com/verygoodplugins/browser-hand/commit/8b3e0c03f222a7ea39ced37f13103dbd1770a86a))
* **cli:** port hidden-tab click refinement and add click-matching tests ([05a3a45](https://github.com/verygoodplugins/browser-hand/commit/05a3a45bf7a918d18d0879277a5445c88d48b31c))
* **cli:** preserve evaluate payload and click warnings in --quiet ([c1405ac](https://github.com/verygoodplugins/browser-hand/commit/c1405ac52d1faf9960ceddf43a5d7a00d19e67d4))
* **cli:** re-rank corrected candidates, enforce the candidate cap per node ([b8322ce](https://github.com/verygoodplugins/browser-hand/commit/b8322ce13eb8ea9226a2cf5d21a104efac958a33))
* **cli:** refuse covered role clicks and publish implicit roles ([4268762](https://github.com/verygoodplugins/browser-hand/commit/4268762b99a4fbbce60290951d5fe7db468a6f89))
* **cli:** reject empty --query instead of listing every tab ([f7eb1c5](https://github.com/verygoodplugins/browser-hand/commit/f7eb1c586f4e08d67e24b4b9e099098c7ecb8cd5))
* **cli:** resolve role clicks with the default snapshot refs ([5472dd3](https://github.com/verygoodplugins/browser-hand/commit/5472dd313964e72d252c6149cf78a10177fd6bf5))
* **cli:** reuse an open tab instead of minting a blank one ([63bf1ae](https://github.com/verygoodplugins/browser-hand/commit/63bf1ae419cd3534ec48d0a17c21dc2b8300e2b4))
* **cli:** reuse an open tab instead of minting a blank one ([8cb1cc1](https://github.com/verygoodplugins/browser-hand/commit/8cb1cc16b3d8eb46555c37fb5c49c93fdda416ae))
* **cli:** score before visibility, keep disabled exact matches, use :disabled ([ebc276c](https://github.com/verygoodplugins/browser-hand/commit/ebc276c8ab5c648f52e1ef08fe8abca75d39c4c5))
* **cli:** share one combobox typing budget across a fill ([35fda4f](https://github.com/verygoodplugins/browser-hand/commit/35fda4fed4564a029cf5f7b38d04ed63ed0ca0e7))
* **cli:** share the snapshot field cap across iframes ([1fca5ab](https://github.com/verygoodplugins/browser-hand/commit/1fca5ab1931f414772c1f2802c01e048b0618091))
* **cli:** skip covered controls in snapshot refs and role clicks ([d542c88](https://github.com/verygoodplugins/browser-hand/commit/d542c884ca5ce650f2c8efce794e757e16f98e5c))
* **cli:** stop snapshot and evaluate from minting named tabs ([d6a8880](https://github.com/verygoodplugins/browser-hand/commit/d6a888019db339790a638ced2e6b97e82bc89a54))
* **cli:** stop snapshot and evaluate from minting named tabs ([339cbe9](https://github.com/verygoodplugins/browser-hand/commit/339cbe9f5f16169f4f45763d75f209a8566d3f5e))
* **cli:** substitute step placeholders and keep evaluate fields ([04fae76](https://github.com/verygoodplugins/browser-hand/commit/04fae76bd2f69bdf11a949d7bb089e6a8cff5fdf))
* **cli:** sync click semantics and second-round Codex fixes from autohub ([7bac3d9](https://github.com/verygoodplugins/browser-hand/commit/7bac3d99803ed5f08f660b8704fa1a46eba84291))
* **cli:** type fill with insertText and select combobox options ([71bf490](https://github.com/verygoodplugins/browser-hand/commit/71bf4906af3970bf72943b3db8d89072c6d93b29))
* **cli:** type fill with insertText and select combobox options ([f066795](https://github.com/verygoodplugins/browser-hand/commit/f06679589323bdbd86b3026c41832da8ba2c6325))
* **cli:** walk the full ranked set, and never re-send a delivered release ([3b73c69](https://github.com/verygoodplugins/browser-hand/commit/3b73c69694e3b4eb41e9fb1d430a78b06c9f8874))
* daemon hardening — frame cap, browser-stop lock, cold-start race, Chrome 147 CDP attach ([#115](https://github.com/verygoodplugins/browser-hand/issues/115)) ([edba515](https://github.com/verygoodplugins/browser-hand/commit/edba515c7e2b7c9209edbe26e4631c5568478902))
* **daemon:** expect the example.com sentence the locator actually returns ([a86c2d0](https://github.com/verygoodplugins/browser-hand/commit/a86c2d0130aab1815a091619fe0da527bab775a7))
* **daemon:** read example.com body text instead of a removed heading ([46953fe](https://github.com/verygoodplugins/browser-hand/commit/46953febf13487605505ed1b21545f485449309e))
* disable viewport emulation in headed mode ([#87](https://github.com/verygoodplugins/browser-hand/issues/87)) ([2122b02](https://github.com/verygoodplugins/browser-hand/commit/2122b024bc669ca146b258c088485256828ad3d1))
* **docs:** run doctor from repo root in challenge gym ([0f1d377](https://github.com/verygoodplugins/browser-hand/commit/0f1d377783c1951dde5635a35e5a903c8116bde3))
* **extension:** fall back when a cached tab group cannot be reused ([6c01790](https://github.com/verygoodplugins/browser-hand/commit/6c0179075e3d294ac5d8577ce13307b7ec1bcfab))
* **extension:** leave a dismissed debugger bar dismissed ([5ba09c9](https://github.com/verygoodplugins/browser-hand/commit/5ba09c9a8da5613ce64e285eb90594004589c74d))
* **extension:** leave a dismissed debugger bar dismissed ([6b60db9](https://github.com/verygoodplugins/browser-hand/commit/6b60db97e06637d434b023d08093150b68b111ae))
* **extension:** run user-script evaluate synchronously first so it works in Search ([7154ad0](https://github.com/verygoodplugins/browser-hand/commit/7154ad0e7bd590507e28bf8a8f2181f9c32d2ae8))
* **extension:** stamp last-focused tab on live inventory ([b806723](https://github.com/verygoodplugins/browser-hand/commit/b8067231ae832cf2159248cc34abfcc0351ae18c))
* **extension:** stamp last-focused tab on live inventory ([b9040d0](https://github.com/verygoodplugins/browser-hand/commit/b9040d04e95b36d27a80304559afc32942c4db6c))
* **extension:** stop chrome:// attach spam and empty error logs ([3192866](https://github.com/verygoodplugins/browser-hand/commit/319286637032cdb33e02eaa3738c231ec0dea737))
* **extension:** sync-first user-script evaluate so CSP-strict pages work in Search ([3263e65](https://github.com/verygoodplugins/browser-hand/commit/3263e654f3987dc6f2a9a15661741053ee21e9d7))
* finish the Browser Hand cutover and land the click-targeting fix ([893b2be](https://github.com/verygoodplugins/browser-hand/commit/893b2be63946f3b058e8ed2f7463271228c5f0b2))
* finish the Browser Hand cutover, repair the CLI binary, land the click-targeting fix ([3c4fd95](https://github.com/verygoodplugins/browser-hand/commit/3c4fd952f2a64b4df6bb5a22289780213fed0765))
* **gym:** default upstream bin to repo launcher ([88e2672](https://github.com/verygoodplugins/browser-hand/commit/88e2672670f223b32aeca242d82e2fa189a396ba))
* **gym:** keep auto-started challenge server on loopback ([009632b](https://github.com/verygoodplugins/browser-hand/commit/009632bdb34e849e080d0edb2af72d1b21cb1b41))
* **gym:** reject bad --driver and probe a real challenge page ([5fe1f13](https://github.com/verygoodplugins/browser-hand/commit/5fe1f135c3bf8094990d1afeb5b7983bdcf76599))
* **gym:** require clean CLI run before counting a pass ([e9e2c25](https://github.com/verygoodplugins/browser-hand/commit/e9e2c25d28774b1d4c4450e3a67fe763e2dcc99b))
* **gym:** skip redundant BH combobox click on challenge 20 ([d10431c](https://github.com/verygoodplugins/browser-hand/commit/d10431cc95d359d21a3930dca1ff734072f6780b))
* handle EBUSY on Windows test cleanup ([b12e2f7](https://github.com/verygoodplugins/browser-hand/commit/b12e2f79e9e9860125fa6e5b2afc9a4981392a88))
* increase timeout for navigation test on Windows CI ([b8e592f](https://github.com/verygoodplugins/browser-hand/commit/b8e592f1347d7ff821ea0338b01bce346de6f473))
* make install-skill work in non-interactive environments ([#84](https://github.com/verygoodplugins/browser-hand/issues/84)) ([94748ec](https://github.com/verygoodplugins/browser-hand/commit/94748ec1cab3a9a0f7ce758f6b253f222dc1a894))
* pin playwright to 1.58.2 to prevent protocol drift ([#95](https://github.com/verygoodplugins/browser-hand/issues/95)) ([5459700](https://github.com/verygoodplugins/browser-hand/commit/5459700f579562d1b6150fba1b01d73d65c1154d))
* read innerText for labels, revalidate before dispatch, atomic named-page attach ([081bc2a](https://github.com/verygoodplugins/browser-hand/commit/081bc2aa71fdcd5d2a5b087af83b2adcca60fc3d))
* **relay:** do not close a user tab from an adopted session ([c9ebee8](https://github.com/verygoodplugins/browser-hand/commit/c9ebee855bbfc8fe300162c1ab4d7761a6fa0818))
* **relay:** keep a reused tab when the client closes its page ([94c982c](https://github.com/verygoodplugins/browser-hand/commit/94c982cda34e05852f0c523b37ddf1d6ecaa6200))
* **relay:** wait for a fresh tab to commit before reporting success ([51f0b0a](https://github.com/verygoodplugins/browser-hand/commit/51f0b0a17200e8ec66f2fe67162ffb1d0d618e46))
* **release:** cut the GitHub release without publishing to npm ([1371270](https://github.com/verygoodplugins/browser-hand/commit/1371270fd07a335cbd2908bee1842d3e8949d171))
* **release:** publish a public manifest from the private repo root ([e6c467b](https://github.com/verygoodplugins/browser-hand/commit/e6c467bafd1d43609d2e31e32ecb5d7e8df430f5))
* resolve Windows CI test timeout in sandbox-file-io ([7f94dae](https://github.com/verygoodplugins/browser-hand/commit/7f94dae87768666f7818cf3a869f457d83dd19f1))
* **skill:** agents + resources frontmatter for AutoVault admission ([683cffc](https://github.com/verygoodplugins/browser-hand/commit/683cffcf56d2c9a1260991789f3bdbb4cf05d5d3))

## [Unreleased]

- Throwaway launches use the connected browser's executable via `browser-hand browser-path`.

## [Extension 1.2.0] - 2026-11-08

- Chrome extension manifest is 1.2.0.
- Added debugger-free page control, so Browser Hand works in Search and other Chromium browsers that block `chrome.debugger`.
- Fixed evaluate in Search on sites with a strict content security policy: user-script evaluation now runs synchronously first and only falls back to the async wrapper for promises.
- The CLI targets the connected browser instead of assuming Chrome.
- Added `close` to shut tabs Browser Hand opened, including about:blank and file:// tabs.

## [0.3.0] - 2026-10-14

- Chrome extension manifest is 1.1.0.
- Added `--group-title` on `open` and `goto`. Tabs for one task join a Chrome tab group with that title and a color. The same title keeps joining the group. A different title starts a new group. With no title, the group stays named Browser Hand. If a saved group cannot be reused in that tab's window, Browser Hand opens a replacement group instead of failing the command.
- Added `steps`, one call for a repeated form (click, fill, type, evaluate, snapshot). The call stops at the first miss, and step snapshots leave formatted secrets out.
- Added a scoped snapshot (open dialog plus main by default) and clicks by snapshot ref or by role and accessible name. Covered controls are skipped. `doctor` stays a short health check. `tabs` is the inventory.
- Snapshot `forms` lists the labeled fields in that same scope.
- Fixed fill so a missed field fails the command, and the read-back keeps unicode and punctuation. A control whose form id is missing is not attached.
- Fixed combobox fill so it types, then chooses the matching option.
- Fixed `open` so an existing tab is reused instead of a new blank one. Snapshot and evaluate no longer create a named tab just to read the page.
- Fixed the debugger infobar: after you dismiss "Browser Hand started debugging this browser", that tab stays on the scripting path and the bar is not brought back.
- Improved the toolbar icon so the crop is the solid glove, not the wrist mist.

## [0.2.9] - 2026-07-14

- Added configurable per-browser idle cleanup with `--idle-timeout`, `DEV_BROWSER_IDLE_TIMEOUT_MS`, and `~/.dev-browser/config.json` support. Idle cleanup preserves persistent profiles, excludes externally connected Chrome, and safely rechecks activity under the per-browser lock before closing.

## [0.2.8] - 2026-06-05

- Added the `page.cua.*` pixel/vision toolset: coordinate-based `click`, `doubleClick`, `drag`, `move`, `scroll`, `keypress`, and `type`, plus a JPEG `screenshot()` whose pixels map 1:1 onto click coordinates at any DPR.
- Added the `page.domCua.*` DOM-id toolset: `getVisibleDom()` snapshots visible interactive elements as `node_id=N` lines, with `click`, `doubleClick`, `scroll`, `type`, and `keypress` acting against the latest snapshot's ids.
- Fixed script error messages being dropped from CLI output; thrown errors now report their name and message alongside the stack.
- Documented the vision and DOM-id workflows in the `--help` LLM usage guide.
- Capped the daemon's per-connection request buffer so a local client can no longer exhaust daemon memory with an unterminated frame.
- Serialized `browser-stop` with the per-browser lock so a browser can no longer be torn down while another client's script is running.
- Hardened daemon cold start against duplicate daemons when concurrent CLI invocations race to spawn one.
- Defaulted `PW_CHROMIUM_ATTACH_TO_OTHER=1` so attaching over CDP to Chrome 147's built-in remote debugging no longer hangs.

## [0.2.7] - 2026-04-09

- Updated documentation to recommend `domcontentloaded` for dev server navigation.

## [0.2.6] - 2026-03-30

- Pinned Playwright version.

## [0.2.5] - 2026-03-30

- Updated Windows documentation with PowerShell examples.
- Use null viewport for headed mode.

## [0.2.4] - 2026-03-26

- Added `--ignore-https-errors` flag for self-signed certificates.

## [0.2.3] - 2026-03-25

- Added Windows x64 compatibility.

## [0.2.1] - 2026-03-19

- Added an interactive `install-skill` TUI command to install the skill into `~/.claude/skills/` and `~/.agents/skills/`.
- Added a `--timeout` flag for script execution with a 30-second default.
- Documented `page.snapshotForAI()` for LLM-friendly page inspection.
- Expanded the `--help` LLM usage guide with approach guidance, screenshots, waiting patterns, and error recovery.
- Simplified the README, added a Windows-not-supported note, and attributed Do Browser.
- Aligned marketplace versioning with `package.json` and added auto-sync support.
- Added `rustfmt` and Prettier plus CI format checks.

## [0.2.0] - 2026-03-19

Initial CLI release.
