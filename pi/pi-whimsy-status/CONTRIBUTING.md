# Contributing

## Development

Run the extension directly while iterating:

```bash
pi --extension ./index.ts
```

Or symlink the repo into Pi's extension directory:

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-whimsy-status
```

Then reload Pi:

```bash
/reload
```

## Publishing checklist

- update `package.json` version
- update `CHANGELOG.md`
- verify `README.md`
- run `npm pack`
- publish with `npm publish`
