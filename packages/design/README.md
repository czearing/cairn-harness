# @cairn/harness-design

Presentational primitives and design tokens shared by Cairn Harness surfaces, so a
second application can look and behave like the harness without copying its source.

The package ships TypeScript and CSS Modules unbuilt. Consumers compile it themselves:

```js
// next.config.ts
const nextConfig = { transpilePackages: ["@cairn/harness-design"] };
```

```tsx
import "@cairn/harness-design/tokens.css";
import { CardSurface, Panel, StatusIndicator, Typography } from "@cairn/harness-design";
```

## Installing outside this repository

`npm` cannot install from a subdirectory of a git repository, so this package is
distributed as a release tarball:

```json
"@cairn/harness-design": "https://github.com/czearing/cairn-harness/releases/download/design-v0.1.0/cairn-harness-design-0.1.0.tgz"
```

Cut a release with `npm pack` in this directory and attach the tarball to a
`design-v<version>` tag.

## Parity with the harness application

`ui/` still holds its own copies of these components. `npm run check:parity`
compares both trees and fails when they diverge, so drift is reported rather than
discovered later. Run it before publishing a new version.
