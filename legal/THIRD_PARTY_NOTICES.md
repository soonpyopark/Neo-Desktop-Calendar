# Neo Desktop Calendar — 제3자 고지 / Third-Party Notices

이 문서는 공개 배포 시 설치본·포터블·About에 함께 둘 **고지**입니다.  
법률 자문이 아니며, 배포 전에 라이선스 원문을 한 번 더 확인하세요.

앱 자체 라이선스(저장소 `LICENSE` / `package.json`): **GNU Affero General Public License v3.0 (AGPL-3.0-only)**  
제품 사이트: https://note4all.tistory.com  
소스: https://gitlab.aigov.go.kr/soonpyo/neo-desktop-calendar  
미러: https://github.com/soonpyopark/Neo-Desktop-Calendar

---

## 0. 앱 라이선스 (AGPL-3.0)

Neo Desktop Calendar 소스와 바이너리 배포물은 **AGPL-3.0**입니다.

- 복사·수정·배포·상업적 이용이 가능하지만, **동일 라이선스(AGPL-3.0)로 소스 공개** 등 AGPL 의무를 지켜야 합니다.
- 수정본을 **네트워크 서비스**로 제공하는 경우(예: 내장 웹 서버로 타인에게 제공)에도 해당 수정본의 소스 제공 의무(AGPL §13)가 적용될 수 있습니다.
- 전문: 저장소·설치본의 `LICENSE`

제3자 구성 요소(Electron, 7-Zip, npm 패키지 등)는 **각각 고유 라이선스**를 따르며, 아래 고지를 유지하세요.

---

## 1. 앱 고지 (사용자에게 보일 요약)

Neo Desktop Calendar는 아래 오픈소스·공개 데이터·런타임을 포함하거나 사용합니다.

- **Electron** (Chromium / Node.js 포함) — MIT 및 구성 요소별 라이선스
- **7-Zip `7za.exe`** — GNU LGPL (Igor Pavlov). 백업 ZIP 생성·해제용으로 **별도 실행 파일**로 호출합니다.
- **ExcelJS, PDFKit, koffi, ws** 등 — 주로 MIT
- **solarlunar** — ISC
- **kor-lunar** — 패키지 저장소 LICENSE 확인 (음력; KASI 공개 데이터 기반 표기)
- **대한민국 공휴일 시드** — 공공데이터포털 「특일 정보」 등 공개 API로 수집한 일정 데이터

본 소프트웨어는 대한민국 정부·공공기관의 공식 제품이 아닙니다.

---

## 2. 7-Zip (필수 고지)

| 항목 | 내용 |
|------|------|
| 구성 | `resources/7zip/7za.exe` (및 동봉 `LICENSE.txt` / `NOTICE.txt`) |
| 저작권 | Copyright (C) Igor Pavlov |
| 라이선스 | GNU Lesser General Public License (LGPL) |
| 홈페이지 | https://www.7-zip.org/ |
| 사용 방식 | 프로세스 실행(`7za`) — 앱에 정적 링크하지 않음 |

**준수 요지 (배포 시)**

1. LGPL 고지와 라이선스 전문(또는 사본 위치)을 사용자에게 제공  
2. 사용자가 `7za.exe`를 교체·업데이트할 수 있도록 분리 유지(현재 구조와 동일)  
3. `7za`를 개조했다면 해당 변경분의 소스 제공 의무가 생길 수 있음  

전체 문구: 설치 폴더 `resources/7zip/LICENSE.txt`, `resources/7zip/NOTICE.txt`

---

## 3. Electron / Chromium / Node.js

| 항목 | 내용 |
|------|------|
| 구성 | MSI·포터블에 Electron 런타임 포함 |
| 라이선스 | Electron MIT + Chromium/Node 등 다수 라이선스 |
| 고지 위치 | 배포본 `LICENSE`(또는 `LICENSES.chromium.html` 등 electron-builder가 넣는 파일) |

고지 파일을 배포물에서 제거하지 말 것.

---

## 4. npm 런타임 의존성 (요약)

| 패키지 | 용도 | 라이선스 (패키지 표기) |
|--------|------|------------------------|
| exceljs | Excel 내보내기 | MIT |
| pdfkit | PDF 내보내기 | MIT |
| koffi | 네이티브 FFI | MIT |
| ws | WebSocket | MIT |
| node-forge | 로컬 HTTPS CA·서버 인증서 | BSD-3-Clause |
| 7zip-bin | `7za` 바이너리 경로 | MIT (바이너리 본체는 7-Zip LGPL) |
| solarlunar | 음력·절기 | ISC |
| kor-lunar | 한국 음력 | 저장소 LICENSE 확인 / npm 라이선스 배지 |

의존성(MIT·ISC 등)은 각 패키지 조건을 따르며, 보통 **저작권·라이선스 고지 유지**가 필요합니다.  
앱 본체 재배포·개작은 **AGPL-3.0**을 따릅니다.

전체 트리의 정확한 목록은 배포 전 `npx license-checker --production` 등으로 재생성할 것을 권장합니다.

---

## 5. 공공데이터 — 대한민국 공휴일

| 항목 | 내용 |
|------|------|
| 데이터 | `holidays-kr` 캘린더 / `src/shared/seed/holidays-kr.json` |
| 출처 | 공공데이터포털 특일 정보(공휴일·대체공휴일) 등 |
| API 키 | 설치본에 기본 키를 넣지 않음. 동기화 시 사용자가 본인 키 사용 |

**권장 고지 문구 (About / 설정)**

> 공휴일 정보는 공공데이터포털 등 공개 데이터를 참고하여 제공됩니다.  
> Neo Desktop Calendar는 정부·공공기관의 공식 서비스가 아니며, 일정은 참고용입니다.

이용약관·공공누리 조건은 배포 시점의 [data.go.kr](https://www.data.go.kr/) 해당 데이터셋 페이지를 확인하세요.  
음력 라이브러리(kor-lunar)는 KASI 공개 데이터 기반임을 README에 명시합니다.

---

## 6. 배포 체크리스트 (초안)

- [ ] 설치 UI `License.rtf`에 앱 **AGPL-3.0** + 7-Zip LGPL + Electron + 공공데이터 출처 요약 포함  
- [ ] 설치/포터블에 `LICENSE`(AGPL 전문) 및 `THIRD_PARTY_NOTICES.md` 포함  
- [ ] `resources/7zip/LICENSE.txt` 유지, `7za.exe` 교체 가능 구조 유지  
- [ ] Electron/Chromium LICENSE 파일이 배포물에 존재하는지 확인  
- [ ] About(트레이 「정보」)에 AGPL·출처·고지 안내  
- [ ] 공식 기관 사칭·오인 소지 문구 제거  
- [ ] 수정·재배포 시 소스 제공 경로(저장소 URL 등) 명시  
- [ ] (선택) `license-checker`로 의존성 라이선스 전수 확인  

**참고:** LGPL `7za`를 별도 프로세스로 쓰는 현재 구조와 AGPL 앱 본체는 병존합니다. `7za` 개조·정적 링크 시 LGPL 의무가 달라질 수 있습니다.

---

## 7. English summary (for bilingual packages)

**Neo Desktop Calendar** is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)**. See the root `LICENSE` file. Source: https://gitlab.aigov.go.kr/soonpyo/neo-desktop-calendar (mirror: https://github.com/soonpyopark/Neo-Desktop-Calendar)

This product also includes:

- **7-Zip (`7za.exe`)**, Copyright (C) Igor Pavlov, licensed under the **GNU LGPL**, invoked as a separate executable for ZIP backup. See `resources/7zip/`.
- **Electron** (and Chromium/Node components) under their respective open-source licenses shipped with the installer.
- Other npm libraries under MIT/ISC as listed above.
- **Korean public holiday data** derived from open government datasets (data.go.kr). This app is **not** an official government product.

Redistribution and modification of **this application** must comply with AGPL-3.0 (including source availability; network use of modified versions may trigger AGPL §13). Third-party components remain under their own licenses with required notices.

---

*Neo Desktop Calendar 배포 컴플라이언스용. 필요 시 변호사 검토를 권장합니다.*
