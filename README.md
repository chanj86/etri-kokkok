# ETRI 콕콕 - 배드민턴 예약 PWA

ETRI 배드민턴 모임의 레슨 순서와 복식 게임 순환을 관리하는 모바일 우선 PWA입니다. Android와 iPhone에서 같은 URL을 사용하며 홈 화면에 설치할 수 있습니다.

## 주요 기능

- 17시 이후 도착 순서대로 레슨 참석
- 1인 15분 기준 순서와 예상 시각 자동 계산
- 미루기, 취소, 월별 레슨 횟수
- 예상 레슨 15분 전 Web Push
- 휴대전화 번호와 비밀번호 로그인
- 복식 4인 게임 슬롯 자율 참여
- 모든 참석자가 참여한 뒤 다음 순환 자동 해제
- 대기시간, 게임 수, 구력, 레슨 횟수, 성별 선택값을 고려한 자동 배치
- 게임 점수, 개인 승패, 파트너별 게임·승리 횟수 기록
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

### 1. 프로젝트 생성과 마이그레이션

Supabase Free 프로젝트를 만든 뒤 CLI로 연결합니다.

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

동호회는 `ETRI 콕콕` 하나로 고정됩니다. 첫 가입자는 관리자, 이후 가입자는 일반 회원이 됩니다. 전화번호는 서버에서 해시 로그인 식별자로 변환하므로 SMS 서비스나 실제 전화번호 저장이 필요하지 않습니다.

### 2. VAPID 키 생성

```bash
npx web-push generate-vapid-keys --json
```

출력된 공개 키와 비밀 키를 별도로 보관합니다.

### 3. Edge Function 비밀값

`AUTH_PEPPER`와 `NOTIFICATION_CRON_SECRET`은 각각 32바이트 이상의 무작위 문자열을 사용하세요.

```bash
npx supabase secrets set \
  AUTH_PEPPER="YOUR_LONG_RANDOM_SECRET" \
  VAPID_PUBLIC_KEY="YOUR_VAPID_PUBLIC_KEY" \
  VAPID_PRIVATE_KEY="YOUR_VAPID_PRIVATE_KEY" \
  VAPID_SUBJECT="mailto:admin@example.com" \
  NOTIFICATION_CRON_SECRET="YOUR_CRON_SECRET" \
  APP_URL="https://YOUR_PROJECT.pages.dev"
```

함수를 배포합니다.

```bash
npx supabase functions deploy phone-auth --no-verify-jwt
npx supabase functions deploy notify-lesson --no-verify-jwt
```

두 함수 모두 자체 인증을 수행합니다. `SUPABASE_SERVICE_ROLE_KEY`는 Supabase 런타임에 기본 제공되며 브라우저 환경 변수에 넣으면 안 됩니다.

### 4. 프런트엔드 환경 변수

`.env.example`을 `.env.local`로 복사하고 실제 값을 입력합니다.

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_VAPID_PUBLIC_KEY=YOUR_VAPID_PUBLIC_KEY
```

### 5. 1분 간격 알림 작업

[supabase/cron.example.sql](supabase/cron.example.sql)의 플레이스홀더를 실제 프로젝트 URL, anon key, `NOTIFICATION_CRON_SECRET`으로 바꾼 뒤 Supabase SQL Editor에서 한 번 실행합니다.

Cron은 매분 `notify-lesson` 함수를 호출합니다. 함수는 예상 시작 15분 전이 된 예약을 잠그고 발송하여 중복 알림을 방지합니다.

## Cloudflare Pages 배포

Git 저장소를 Cloudflare Pages에 연결하고 다음 값을 사용합니다.

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- 환경 변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`

SPA 경로 처리는 `public/_redirects`, 보안 헤더는 `public/_headers`에 포함되어 있습니다.

배포 후 실제 Pages 주소로 `APP_URL` Edge Function secret을 다시 설정하세요.

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
