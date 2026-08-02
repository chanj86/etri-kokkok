# ETRI 콕콕 - 배드민턴 예약 PWA

ETRI 배드민턴 모임의 레슨 순서와 복식 게임 순환을 관리하는 모바일 우선 PWA입니다. Android와 iPhone에서 같은 URL을 사용하며 홈 화면에 설치할 수 있습니다.

## 주요 기능

- 17시 이후 도착 순서대로 레슨 참석
- 1인 15분 기준 순서와 예상 시각 자동 계산
- 미루기, 취소, 월별 레슨 횟수
- 예상 레슨 15분 전 Web Push
- 휴대전화 번호와 비밀번호 로그인
- 복식 4인 게임 슬롯 자율 참여와 게임 삭제
- 코트 배치도에서 코트 선택·상태(사용 가능/모집중/게임중)·경과 시간 확인
- 순환 권고: 모든 참석자가 참여하면 다음 순환이 열리고, 차례가 아니어도 재확인 후 참여 가능
- 대기시간, 게임 수, 구력, 레슨 횟수, 성별 선택값을 고려한 자동 배치
- 게임 점수, 개인 승패, 파트너별 게임·승리 횟수 기록
- 커뮤니티: 회원 목록·회원별 전적, 공지사항, 외부게임 매칭 게시판
- 프로필 사진 등록
- 동호회 단위 RLS와 실시간 갱신

상세 설계는 [docs/APP_DESIGN.md](docs/APP_DESIGN.md)를 참고하세요.

## 기술 구성

- React, TypeScript, Vite
- Vite PWA, Workbox
- Supabase Auth, PostgreSQL, Realtime, Edge Functions, Cron
- 표준 Web Push, VAPID
- Cloudflare Pages

## 로컬 미리보기

Node.js 20 이상이 필요합니다.

```bash
npm install
npm run dev
```

Supabase 환경 변수가 없으면 로그인 화면의 `데모 입장`으로 모든 주요 화면과 동작을 확인할 수 있습니다. 데모 데이터는 서버에 저장되지 않으며 새로고침하면 초기화됩니다.

## Supabase 연결

### 1. 비밀값 준비

`AUTH_PEPPER`, `NOTIFICATION_CRON_SECRET`, VAPID 키를 만들어 `supabase/.env`에 저장합니다. 이 파일은 Git에서 제외됩니다.

```bash
cp supabase/.env.example supabase/.env
npx web-push generate-vapid-keys --json
openssl rand -hex 32
```

### 2. 프로젝트 생성

[Supabase 대시보드](https://supabase.com/dashboard)에서 무료 프로젝트를 만들고 리전은 서울 등 가까운 곳을 선택합니다. 생성 시 입력한 데이터베이스 비밀번호를 안전하게 보관하세요.

### 3. 연동 스크립트 실행

브라우저 로그인이 필요하므로 사용자 터미널에서 실행합니다.

```bash
./scripts/setup-supabase.sh
```

스크립트는 CLI 로그인, 프로젝트 연결, 마이그레이션 적용, Edge Function 비밀값 등록과 배포, `.env.local` 생성을 순서대로 처리합니다. 배포 주소가 정해진 뒤에는 다음처럼 다시 실행해 `APP_URL`만 갱신할 수 있습니다.

```bash
./scripts/setup-supabase.sh --app-url https://your-project.pages.dev
```

동호회는 `ETRI 콕콕` 하나로 고정됩니다. 첫 가입자는 관리자, 이후 가입자는 일반 회원이 됩니다. 전화번호는 서버에서 해시 로그인 식별자로 변환하므로 SMS 서비스나 실제 전화번호 저장이 필요하지 않습니다.

`SUPABASE_SERVICE_ROLE_KEY`는 Supabase 런타임이 기본 제공하므로 별도로 등록하지 않으며, 브라우저 환경 변수에 넣으면 안 됩니다.

### 4. 1분 간격 알림 작업

연동 스크립트가 실제 값을 채운 `supabase/cron.local.sql`을 만들어 줍니다. 이 파일 내용을 Supabase SQL Editor에 붙여 넣고 한 번만 실행하세요. 수동으로 작성하려면 [supabase/cron.example.sql](supabase/cron.example.sql)을 참고합니다.

Cron은 매분 `notify-lesson` 함수를 호출합니다. 함수는 예상 시작 15분 전이 된 예약을 잠그고 발송하여 중복 알림을 방지합니다.

### 5. 연동 점검

[supabase/verify.sql](supabase/verify.sql)을 SQL Editor에서 실행하면 동호회, 회원, 관리자, 알림 예약 상태를 표로 확인할 수 있습니다. 읽기 전용 쿼리입니다.

## Cloudflare Pages 배포

### 1. Git 원격 저장소 연결

```bash
git remote add origin https://github.com/<사용자명>/<저장소명>.git
git push -u origin main
```

### 2. Workers 프로젝트 생성

Cloudflare 대시보드에서 `Compute (Workers & Pages)` → `Create` → Git 저장소 연결 후 다음 값을 사용합니다.

- Project name: `etri-kokkok`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

배포 설정은 [wrangler.jsonc](wrangler.jsonc)에 있습니다. 서버 코드 없이 `dist` 폴더만 엣지에 올리며, `not_found_handling`이 SPA 경로를 처리합니다. Node 버전은 `.nvmrc`의 `22`가 적용됩니다.

빌드에 필요한 공개 환경 변수는 [.env.production](.env.production)에 들어 있어 대시보드에서 따로 등록하지 않아도 됩니다. 이 파일에는 브라우저에 노출되어도 안전한 값만 두며, 비밀값은 `supabase/.env`에만 보관합니다.

보안 헤더는 `public/_headers`에 정의되어 있습니다.

로컬에서 배포와 동일한 환경을 확인하려면 다음을 실행합니다.

```bash
npm run build
npx wrangler dev --local
```

### 3. 배포 주소 반영

```bash
./scripts/setup-supabase.sh --app-url https://<프로젝트명>.pages.dev
```

Supabase 대시보드의 `Authentication` → `URL Configuration` → `Site URL`도 같은 주소로 설정하세요.

## iPhone 알림 조건

iOS/iPadOS 16.4 이상에서 다음 순서가 필요합니다.

1. Safari로 배포 URL 접속
2. 공유 버튼에서 `홈 화면에 추가`
3. 홈 화면의 ETRI 콕콕 앱 실행
4. 앱 안에서 `알림 켜기`

Safari 탭으로만 사용하면 iPhone Web Push가 동작하지 않습니다. 알림을 허용하지 않아도 앱 안의 순서와 예상 시각은 계속 표시됩니다.

## 검증 명령

```bash
npm run lint
npm test
npm run typecheck
npm run functions:check
npm run build
```

Docker가 설치된 환경에서는 Supabase 로컬 스택으로 데이터베이스 테스트를 실행할 수 있습니다.

```bash
npx supabase start
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/database_invariants.sql
```

데이터베이스 테스트는 다음을 검증합니다.

- 6명 참석 시 `ABCD → EFAB → CDEF` 형태의 순환 경계
- 같은 순환의 중복 참여와 활성 슬롯 중복 참여 차단
- 자동 배치 4인 저장
- 게임 점수 수정 시 게임 횟수 중복 증가 방지
- 파트너별 전체 게임 수와 승리 횟수 집계
- 레슨 미루기/취소 후 15분 간격 재정렬
- 다른 동호회 데이터 RLS 차단

## 무료 운영 시 주의

Supabase Free는 소규모 동호회 MVP에 충분하지만 데이터베이스와 네트워크 한도가 있고 비활동 프로젝트가 일시정지될 수 있습니다. Cloudflare Pages의 정적 파일 요청은 무료 범위가 넓지만 두 서비스 모두 무료 플랜에서 가용성을 보장하지 않습니다.

실제 키가 담긴 `.env`, 서비스 역할 키, `AUTH_PEPPER`, VAPID private key는 Git에 커밋하지 마세요.
