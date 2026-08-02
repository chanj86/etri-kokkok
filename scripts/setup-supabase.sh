#!/usr/bin/env bash
# ETRI 콕콕 Supabase 연동 스크립트
#
# 사용법:
#   ./scripts/setup-supabase.sh                      대화형으로 프로젝트 정보를 입력
#   ./scripts/setup-supabase.sh --app-url https://... 배포 주소만 갱신하며 다시 실행
#
# 이 스크립트는 다음을 수행합니다.
#   1. Supabase CLI 로그인 확인
#   2. 프로젝트 연결
#   3. 데이터베이스 마이그레이션 적용
#   4. Edge Function 비밀값 등록
#   5. Edge Function 배포
#   6. .env.local 에 프런트엔드 환경 변수 기록
#   7. supabase/cron.local.sql 에 알림 예약 SQL 생성

set -euo pipefail

cd "$(dirname "$0")/.."

SECRETS_FILE="supabase/.env"
FRONTEND_ENV_FILE=".env.local"
APP_URL_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-url)
      APP_URL_OVERRIDE="${2:-}"
      shift 2
      ;;
    *)
      echo "알 수 없는 옵션입니다: $1" >&2
      exit 1
      ;;
  esac
done

step() {
  printf '\n\033[1;34m[%s]\033[0m %s\n' "$1" "$2"
}

fail() {
  printf '\n\033[1;31m오류:\033[0m %s\n' "$1" >&2
  exit 1
}

[[ -f "$SECRETS_FILE" ]] || fail "$SECRETS_FILE 파일이 없습니다. 비밀값 파일을 먼저 준비하세요."

step 1/7 "Supabase CLI 로그인 상태를 확인합니다."
if npx supabase projects list >/dev/null 2>&1; then
  echo "이미 로그인되어 있습니다."
else
  echo "브라우저가 열리면 로그인을 완료해 주세요."
  npx supabase login
fi

LINKED_REF_FILE="supabase/.temp/project-ref"
LINKED_REF=""
[[ -f "$LINKED_REF_FILE" ]] && LINKED_REF="$(cat "$LINKED_REF_FILE")"

# 이미 연결된 프로젝트의 배포 주소만 바꾸는 경우에는
# 연결과 마이그레이션을 건너뛰어 데이터베이스 비밀번호 없이 실행할 수 있게 한다.
UPDATE_ONLY=0
if [[ -n "$APP_URL_OVERRIDE" && -n "$LINKED_REF" ]]; then
  UPDATE_ONLY=1
fi

if [[ "$UPDATE_ONLY" -eq 1 ]]; then
  PROJECT_REF="$LINKED_REF"
  step 2/7 "이미 연결된 프로젝트($PROJECT_REF)를 사용합니다."
  step 3/7 "마이그레이션은 이미 적용되어 건너뜁니다."
else
  step 2/7 "Supabase 프로젝트를 연결합니다."
  PROJECT_REF="${SUPABASE_PROJECT_REF:-$LINKED_REF}"
  if [[ -z "$PROJECT_REF" ]]; then
    echo "대시보드 주소 https://supabase.com/dashboard/project/<여기가 Project Ref> 를 확인하세요."
    read -r -p "Project Ref: " PROJECT_REF
  fi
  [[ -n "$PROJECT_REF" ]] || fail "Project Ref 를 입력해야 합니다."

  DB_PASSWORD="${SUPABASE_DB_PASSWORD:-}"
  if [[ -z "$DB_PASSWORD" ]]; then
    read -r -s -p "데이터베이스 비밀번호 (프로젝트 생성 시 입력한 값): " DB_PASSWORD
    echo
  fi
  [[ -n "$DB_PASSWORD" ]] || fail "데이터베이스 비밀번호를 입력해야 합니다."

  npx supabase link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD" --yes

  step 3/7 "데이터베이스 마이그레이션을 적용합니다."
  npx supabase db push --linked --password "$DB_PASSWORD" --yes
fi

step 4/7 "Edge Function 비밀값을 등록합니다."
if [[ -n "$APP_URL_OVERRIDE" ]]; then
  echo "APP_URL 을 $APP_URL_OVERRIDE 로 갱신합니다."
  TMP_SECRETS="$(mktemp)"
  grep -v '^APP_URL=' "$SECRETS_FILE" > "$TMP_SECRETS"
  printf 'APP_URL=%s\n' "$APP_URL_OVERRIDE" >> "$TMP_SECRETS"
  mv "$TMP_SECRETS" "$SECRETS_FILE"
fi
npx supabase secrets set --project-ref "$PROJECT_REF" --env-file "$SECRETS_FILE"

step 5/7 "Edge Function 을 배포합니다."
npx supabase functions deploy phone-auth --project-ref "$PROJECT_REF" --no-verify-jwt
npx supabase functions deploy notify-lesson --project-ref "$PROJECT_REF" --no-verify-jwt

step 6/7 "프런트엔드 환경 변수를 기록합니다."
API_KEYS_JSON="$(npx supabase projects api-keys --project-ref "$PROJECT_REF" --output json)"
PUBLIC_KEY="$(
  API_KEYS_JSON="$API_KEYS_JSON" node -e '
    const raw = JSON.parse(process.env.API_KEYS_JSON)
    const keys = Array.isArray(raw) ? raw : (raw.keys ?? [])
    const pick = (name) =>
      keys.find((key) => (key.name ?? key.type ?? "").toLowerCase() === name)
    const chosen = pick("publishable") ?? pick("anon")
    if (!chosen) throw new Error("공개 API 키를 찾을 수 없습니다.")
    process.stdout.write(chosen.api_key ?? chosen.apiKey ?? chosen.value ?? "")
  '
)"
[[ -n "$PUBLIC_KEY" ]] || fail "공개 API 키를 가져오지 못했습니다. 대시보드에서 직접 확인해 주세요."

VAPID_PUBLIC_KEY="$(grep '^VAPID_PUBLIC_KEY=' "$SECRETS_FILE" | cut -d= -f2-)"

cat > "$FRONTEND_ENV_FILE" <<EOF
# 이 파일은 scripts/setup-supabase.sh 가 자동으로 생성합니다.
VITE_SUPABASE_URL=https://${PROJECT_REF}.supabase.co
VITE_SUPABASE_ANON_KEY=${PUBLIC_KEY}
VITE_VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
EOF

step 7/7 "알림 예약 SQL 을 생성합니다."
CRON_SECRET="$(grep '^NOTIFICATION_CRON_SECRET=' "$SECRETS_FILE" | cut -d= -f2-)"
CRON_FILE="supabase/cron.local.sql"

cat > "$CRON_FILE" <<EOF
-- scripts/setup-supabase.sh 가 실제 값으로 생성한 파일입니다.
-- Supabase 대시보드의 SQL Editor 에 붙여 넣고 한 번만 실행하세요.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('notify-lesson-every-minute')
where exists (
  select 1 from cron.job where jobname = 'notify-lesson-every-minute'
);

select cron.schedule(
  'notify-lesson-every-minute',
  '* * * * *',
  \$\$
  select net.http_post(
    url := 'https://${PROJECT_REF}.supabase.co/functions/v1/notify-lesson',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '${PUBLIC_KEY}',
      'x-cron-secret', '${CRON_SECRET}'
    ),
    body := jsonb_build_object('triggeredAt', now()),
    timeout_milliseconds := 10000
  );
  \$\$
);
EOF

printf '\n\033[1;32m완료했습니다.\033[0m\n'
echo "프로젝트 URL: https://${PROJECT_REF}.supabase.co"
echo

if [[ "$UPDATE_ONLY" -eq 1 ]]; then
  echo "배포 주소를 $APP_URL_OVERRIDE 로 반영했습니다."
  echo "푸시 알림의 링크가 이 주소를 가리킵니다."
else
  echo "남은 작업"
  echo "  1. $CRON_FILE 내용을 Supabase SQL Editor 에 붙여 넣고 실행 (레슨 알림 예약)"
  echo "  2. npm run dev 로 실제 서버 연동 확인"
  echo "  3. Cloudflare 에 배포"
  echo "  4. ./scripts/setup-supabase.sh --app-url https://<배포주소> 로 다시 실행"
fi
