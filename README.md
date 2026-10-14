# Philo Personna

경영 난관이 있는 하루 일정을 입력하면 철학자와 문학 인물 페르소나가 전략적 행동지침을 제안하는 정적 웹앱입니다.

## 기능

- 시간, 상대, 상황, 난관 유형을 입력해 하루 일정을 구성
- 34명의 철학자, 사상가, 문학 인물 페르소나 중 상황에 맞는 인물 추천
- 선택한 페르소나 스타일로 일정별 행동지침과 복사 가능한 대사 생성
- 브라우저가 열려 있는 동안 일정 10분 전 알림 설정
- 입력한 일정과 선택한 페르소나를 브라우저 저장소에 보관
- 전략 요약을 클립보드로 복사

## 실행

`index.html` 파일을 브라우저에서 열면 바로 실행됩니다.

## 메모

현재 버전은 별도 서버나 외부 API 없이 동작하는 MVP입니다. 앱 내부의 페르소나 지식베이스와 키워드 매칭으로 추천합니다. 이후 AI API를 연결하면 앱이 입력 상황을 더 깊이 해석하고, 내부에 없는 철학자나 문학 인물까지 동적으로 탐색해 응답하도록 확장할 수 있습니다.


## 홈 화면에 앱 추가

- Android/데스크톱: HTTPS 사이트를 Chrome 또는 지원 브라우저로 열고 **앱 설치**를 선택합니다.
- iPhone/iPad: Safari에서 사이트를 열고 **공유 → 홈 화면에 추가**를 선택합니다.
- 앱 셸은 오프라인에서도 열리지만 상담 세션 API는 네트워크 연결이 필요합니다.


## Enable real conversations and saved history

The deployed pages send chat requests to the Render service at `https://mindset1000.onrender.com`. The server calls the OpenAI Responses API and saves conversation messages and session context in PostgreSQL. The API key stays on the server and must never be added to HTML or JavaScript.

In the Render service environment, set:

- `OPENAI_API_KEY`: an API key from the OpenAI Platform. API usage is billed separately from ChatGPT subscriptions.
- `DATABASE_URL`: the connection string for a PostgreSQL database. Render's service filesystem is temporary, so in-memory or file-only history will not survive restarts.
- `OPENAI_MODEL`: optional; defaults to `gpt-6-luna`.

After saving the environment variables, redeploy `mindset1000`. Check `https://mindset1000.onrender.com/api/health`; `chatReady` should be `true`. GitHub Pages remains the public frontend, while its chat requests use the Render API. Conversation history is separated by advisor and saved in the browser's session ID; clearing that browser's local storage starts a new conversation.
