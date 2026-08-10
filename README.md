# Neo Desktop Calendar v1.2.0

Lightweight Electron desktop wallpaper calendar with dynamic click-through.

## License

**GNU Affero General Public License v3.0 (AGPL-3.0-only)** — see [`LICENSE`](LICENSE).

소스·바이너리 재배포·개작 시 AGPL-3.0 의무(소스 제공 등)가 적용됩니다.  
제3자 구성 요소 고지: [`legal/THIRD_PARTY_NOTICES.md`](legal/THIRD_PARTY_NOTICES.md)

## Stack

- Electron (main)
- React + TypeScript (renderer)
- Tailwind CSS v4
- IPC click-through bridge (`set-ignore-mouse`)

## Features

- Frameless, transparent, taskbar-hidden window
- Desktop embed under icons via WorkerW `SetParent` (바탕화면 모드)
- Empty space clicks pass through to the OS desktop
- Interactive controls (nav, events, add) capture mouse on hover (`.interaction-ui`)
- Settings → **서버 관리** (super_admin): HTTP port, Local/Web start·stop, firewall inbound
- Month toolbar `[-]`/`[+]` event density scales main bars and quick-edit list titles together
- Calendar / backup ZIP import·export via bundled `7za` (UTF-8 filenames, `-mcu=on`)

## Develop

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
npm run dev
npm run dev:restart
npm run stop
```

### 브라우저에서 테스트 (개발 중)

Electron 앱(`npm run dev`)이 실행 중일 때 HTTP API(기본 `:3010`)와 Vite UI(`:5173`)가 함께 뜹니다.

1. 터미널 1: `npm run dev` (또는 `npm run dev:restart`)
2. 터미널 2: `npm run browser:dev` — 준비되면 브라우저를 엽니다  
   또는 직접 **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)** 접속

- UI는 **Vite(5173)** 에서 제공하고, `/api`·`/ws`는 Vite가 **CalendarWebServer(3010)** 로 프록시합니다.
- `:3010`만 열면 dev 모드에서 Vite(5173)로 리다이렉트됩니다.
- `.env`에 `PORT=3010`이 있어야 합니다 (`.env.example` 참고).

Admin login credentials come from `.env` (`MYCALENDAR_ADMIN_ID` / `MYCALENDAR_ADMIN_PW`), with `NEOCALENDAR_*` / `ADMIN_*` aliases and built-in defaults as fallback.

### Roles & permissions

| Role | Can do |
| --- | --- |
| `super_admin` (총괄관리자) | Full calendar store, members, security/IP, **서버 관리**, holiday API sync, ZIP backup/import |
| `member` (일반사용자) | Own calendars & events, tags, account password change, Excel/PDF export of own data, view holidays |
| Guest (logged out) | Empty store; must log in to edit |

- Session role is loaded from `data/members.json` on login/restore.
- Settings → **내 계정** is available to every logged-in user for password change.
- Admin-only Settings tabs (보안·서버 관리·회원·공휴일 동기화·전체 가져오기/내보내기) and matching IPC/HTTP APIs reject non-admins with “권한이 없습니다.”
- Agent rule: `.cursor/rules/neo-permissions.mdc`

## Build

```bash
npm run build
npm run dist
```

### MSI 설치판 (MDC와 동일 흐름)

```bash
npm run build:msi
```

사전 요구: [WiX CLI 7+](https://wixtoolset.org/) (`winget install WiXToolset.WiXCLI`) 후 `wix eula accept wix7`  
대한민국 공휴일은 커밋된 `src/shared/seed/holidays-kr.json`(현재 3년치)을 그대로 번들합니다.
**빌드는 이 파일을 갱신하지 않습니다.** 갱신이 필요할 때만 `npm run seed:holidays`를 직접 실행하면
실행 연도부터 3년치를 API에서 받아 다시 굽습니다. 이때만 `.env`(또는 환경 변수)의
`DATA_GO_KR_SERVICE_KEY`를 사용하며, **API 키는 설치본과 앱 설정에 저장되지 않습니다** —
사용자는 휴일 데이터를 키 없이 그대로 받고, 최신화가 필요하면 설정에서 본인 키로 동기화합니다
(「저장」을 직접 체크한 경우에만 그 키가 설정에 남습니다).  
→ `msi/Neo Desktop Calendar v{버전}_YYMMDD_HHMMSS.msi` (현재 사용자 설치, 관리자 권한 불필요)  
설치 마법사에서 **설치 폴더 선택** 가능 (`WixUI_InstallDir`).  
MSI에는 Electron 런타임이 포함됩니다 (`Neo Desktop Calendar.exe` + `resources/app.asar` + DLL). 별도 Electron 설치 불필요.

| 스크립트 | 설명 |
| --- | --- |
| `npm run dist` | NSIS 설치 파일 (`release/`) |
| `npm run build:msi` | WiX MSI 설치판 (`msi/*.msi`) |
| `npm run build:portable` | 포터블 zip (`msi/*_portable.zip`, 7-Zip 필요) |
| `npm run sync-version` | `constants.ts` 버전 → package.json / License.rtf / 고지 동기화 |
| `npm run update:all` | npm 의존성 업데이트 (+ desktop-hit 헬퍼 재빌드) |
| `npm run build:update_all` | `update:all` 후 MSI 빌드 |

공개 배포 시 라이선스: **AGPL-3.0** ([`LICENSE`](LICENSE))  
제3자 고지: [`legal/THIRD_PARTY_NOTICES.md`](legal/THIRD_PARTY_NOTICES.md)  
(설치본: `resources/notices/LICENSE`, `resources/notices/THIRD_PARTY_NOTICES.md`)

### 의존성 업데이트

NAS4USB와 같은 흐름입니다.

```bash
npm run update:all
```

옵션: `--skip-git` `--skip-npm` `--skip-hit` `--build` `--msi`  
예: `npm run update:all -- --build`  
Windows: `update_all.bat` (로그: `.cache/logs/update-all.log`)

## Click-through model

1. Main process starts with `setIgnoreMouseEvents(true, { forward: true })`
2. Renderer `WallpaperContainer` keeps ignore enabled for empty space
3. `InteractionUI` calls `setIgnoreMouseEvents(false)` on `mouseenter`
4. Leaving interactive UI / the window re-enables click-through
