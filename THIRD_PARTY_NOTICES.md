# Third-party software

## AFFiNE

The local notes workspace is based on [AFFiNE v0.27.4](https://github.com/toeverything/AFFiNE/tree/b4c8548c09da21b2898443559a5b846f0ccf5dd8), commit `b4c8548c09da21b2898443559a5b846f0ccf5dd8`.

Copyright (c) 2022-present TOEVERYTHING PTE. LTD. and its affiliates.

AFFiNE uses multiple licenses. Its [root license](https://github.com/toeverything/AFFiNE/blob/b4c8548c09da21b2898443559a5b846f0ccf5dd8/LICENSE) places most frontend code under MIT and identifies separate terms for backend/native directories and third-party components. The referenced [CE/EE license](https://github.com/toeverything/AFFiNE/blob/b4c8548c09da21b2898443559a5b846f0ccf5dd8/packages/backend/server/LICENSE) distinguishes MPL-2.0 community/client-side portions from enterprise-only software. This integration builds the web workspace; it does not include or unlock an AFFiNE enterprise backend or subscription service.

The unmodified corresponding source is available at the pinned repository URL above. Our complete source changes are in [integrations/affine/local.patch](integrations/affine/local.patch), including the local AI adapter and its tests. Build instructions are in [docs/affine-integration.md](docs/affine-integration.md).

The application bundle includes the upstream license texts, the source modification patch, and the pinned version manifest in its `affine/licenses/` and `affine/build-manifest.json` resources. Third-party dependency notices emitted by the upstream bundler remain with their assets. Existing copyrights, licenses, and applicable redistribution/source obligations are retained.
