# schedule-parser

병동 근무표를 개인 달력과 인수인계 상세보기로 보여주는 Expo 웹 앱.
GitHub Pages에는 앱 코드만 배포하며, 가져온 근무표는 브라우저의 IndexedDB에 저장한다.
근무표를 전송하는 서버나 분석 도구는 없다.

## 현재 사용 흐름

1. JSON 가져오기에서 근무표 백업을 선택한다.
2. 내 이름을 선택하고 달력에서 날짜를 연다.
3. JSON 백업으로 현재 근무표를 내보내거나, 삭제로 기기에서 제거한다.

여러 근무표를 저장할 수 있다. 동일 ID를 가져오면 덮어쓰기 확인을 받는다.
기기·브라우저별 저장이며 자동 동기화는 없다. 브라우저 데이터 삭제에 대비해 백업을 보관한다.
같은 GitHub Pages 호스트의 다른 프로젝트와 구분하기 위해 저장소 이름에 앱 경로를 포함한다.

사진 인식은 현재 Node 개발 도구에서 실행한다. 웹 사진 입력·검수 화면,
Service Worker 오프라인 캐시와 설치용 manifest는 아직 구현하지 않았다.
네이티브 앱의 기기 저장도 후속 작업이다.

## 개발

```bash
npm ci
npm test
npm run typecheck
npm run app
npm run app:build
```

`npm test`는 개인정보 없는 도메인·백업 검증 테스트를 실행한다.
`npm run typecheck`는 핵심 패키지와 앱을 모두 검사한다.

```text
packages/domain/     근무 코드, 근무표 모델, 인수인계 계산
packages/vision/     사진의 표 격자 복원
packages/recognize/  근무 코드와 사번 템플릿 매칭
apps/mobile/        Expo 앱, 웹 로컬 저장과 JSON 가져오기
tools/              로컬 사진 진단·파싱 도구
```

핵심 패키지는 React Native·브라우저 API에 의존하지 않는다.
모르는 근무 코드도 원문을 보존하며, 사람 식별에는 사번을 사용한다.

## 비공개 회귀 자료

실제 사진·정답지·내보낸 근무표와 개인정보가 포함된 기존 문서는 Git에서 제외한다.
해당 자료를 로컬에 가진 개발자만 아래 명령을 실행할 수 있다.

```bash
npm run test:fixtures
npm run metrics
npm run export
```

필요한 파일은 `fixtures/roster-2026-09.jpg`, `fixtures/labels-2026-09.json`,
`fixtures/empno-2026-09.json`이다. `npm run export`의 결과인
`apps/mobile/assets/roster-2026-09.json`은 앱에서 수동으로 가져올 수 있으며 번들에 포함되지 않는다.

## GitHub Pages

1. 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 설정한다.
2. **Actions → Deploy GitHub Pages → Run workflow**를 실행한다.
3. 배포가 끝나면 `github-pages` 환경의 URL로 접속한다.

Workflow는 공개 테스트·타입 검사 후 `apps/mobile/dist`만 배포한다.
Pages 하위 경로는 자동으로 적용한다. 로컬에서 동일한 경로로 빌드하려면:

```bash
PAGES_BASE_PATH=/schedule-parser npm run app:build
```

기본 빌드는 루트 경로를 사용한다. main에 push하면 자동 배포하며 수동 실행도 가능하다.
