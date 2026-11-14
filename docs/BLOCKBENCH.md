# Voxellume — Blockbench integration

Blockbench is an optional desktop editor for models and bone animation. Voxellume
ships no Blockbench wrapper: the editor is driven through its own MCP plugin, and the
produced files are validated by `minecraft_assets_check`.

## What runs where

- The MCP server runs **inside the launched Blockbench desktop application**.
- There is **no headless CLI**. `blockbench --headless` style invocation does not
  expose the MCP endpoint, so CI and offline agents cannot use it.
- The plugin never opens a socket itself. It documents the endpoint; the harness
  connects to it.
- Access is loopback only. Do not bind the endpoint to a routable interface.

## Pinned plugin

| Item             | Value                                      |
| ---------------- | ------------------------------------------ |
| Plugin           | `blockbench-mcp`                           |
| Version          | 1.10.1                                     |
| Revision         | `97a8a80d3a37bf95c5e136d93d2c7da399fff753` |
| Host application | Blockbench 5.x desktop                     |
| Transport        | HTTP on loopback, MCP endpoint `/bb-mcp`   |
| Default port     | 3000                                       |

Install the plugin from the pinned revision with Blockbench's own plugin manager or
by placing the built plugin bundle in the Blockbench plugins directory, then restart
the application.

## Settings

| Setting        | Value       | Why                                         |
| -------------- | ----------- | ------------------------------------------- |
| `mcp_port`     | `3000`      | Default; change only when the port is taken |
| `mcp_endpoint` | `/bb-mcp`   | Default path for MCP requests               |
| `risky_eval`   | disabled    | Keeps arbitrary script evaluation off       |
| Bind address   | `127.0.0.1` | Loopback only                               |

With those settings the endpoint is `http://127.0.0.1:3000/bb-mcp`. Keep
`risky_eval` disabled: it lets a caller execute arbitrary editor JavaScript, which
turns a model edit into code execution on the workstation.

## Client configuration

A generic MCP client that supports HTTP servers:

```json
{
  "mcpServers": {
    "blockbench": {
      "url": "http://127.0.0.1:3000/bb-mcp"
    }
  }
}
```

A client that only supports stdio servers can bridge to the same endpoint:

```json
{
  "mcpServers": {
    "blockbench": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3000/bb-mcp"]
    }
  }
}
```

The second form requires the client to have network access to loopback and the
bridge package installed. Neither form is shipped by Voxellume.

## Export flow

1. Open the model in the desktop application and confirm the project format matches
   the runtime format. Java Block/Item and Modded Entity formats are not
   interchangeable.
2. Keep the editable `.bbmodel` outside the mod's resource tree. A reasonable
   location is `art/models/`.
3. Export Java Block/Item JSON into the project asset tree, for example
   `src/main/resources/assets/ruby_tools/models/item/ruby.json`, and the texture to
   `src/main/resources/assets/ruby_tools/textures/item/ruby.png`.
4. Validate the result:

   ```json
   {
     "projectRoot": "ruby-tools",
     "textures": [
       "src/main/resources/assets/ruby_tools/textures/item/ruby.png::16x16"
     ],
     "models": ["src/main/resources/assets/ruby_tools/models/item/ruby.json"]
   }
   ```

   `minecraft_assets_check` reports `model_texture_missing` when a model references
   a texture that is not on disk, `dimension_mismatch` when an asserted size is
   wrong, and `png_invalid`/`png_too_large` when the PNG is unusable.

5. Prove the mod loads the asset with `minecraft_run`. A Blockbench render is a
   preview, not runtime evidence.

## Limits

- No headless mode, so no CI job can drive the editor.
- The plugin revision is fixed. Do not upgrade it inside a project that was authored
  against 1.10.1 without re-validating the exported files.
- The editor is optional. A mod with only JSON and PNG assets never needs it.
