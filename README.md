# BetterSpool
![image](https://img.shields.io/badge/VS_Code-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white)
![image](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

Browse and view IBM i (AS/400) spooled files, on top of Db2 for IBM i / Code for IBM i
<img width="2160" height="988" alt="Zrzut ekranu 2026-10-27 o 16 24 03" src="https://github.com/user-attachments/assets/d672e6c1-9e1b-4251-b1e6-874087142a37" />


## Features
- **Filter** view - filter for spools you need the most
- **Spooled Files** view: name, creation date + time - everything to be sure it is the right file
- **Show Spool** opens the content as a read-only document (`betterspool:` scheme)
- **Works with AI** - Copilot sees what you see! Help youself with some AI
- **Starting SQL job** - if you forgot to start one, extension will help you to do it - everything from one place


## Requirements
- [DB2 for IBM i](https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.vscode-db2i)
- [Code for IBM i](https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.code-for-ibmi)


## SQL used

- List: `QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC`
- Content: `SYSTOOLS.SPOOLED_FILE_DATA`

Every statement is logged in the **BetterSpool** output channel.

## Settings

| Setting | Default | Description |
|---|---|---|
| `betterspool.sqlBackend` | `auto` | `auto` (Db2 for i, then Code for IBM i), `db2i`, `codeForIBMi` |
| `betterspool.maxRows` | `500` | Default max rows in the list |
| `betterspool.queryTimeout` | `60` | Seconds before an SQL request is abandoned (0 = none) |
| `betterspool.trimTrailingSpaces` | `true` | Trim trailing blanks in spool lines |


## ⚠️ Disclaimer & License

This is just a small project created for fun and utility. **Use at your own risk!**