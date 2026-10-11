# 브리지 (이 PC에서 도는 연결 프로그램)

GitHub Pages의 악보 페이지가 이 PC에 맡기는 일을 처리함.

| 하는 일 | 주소 (127.0.0.1:47615) |
|---|---|
| 유튜브 채보 작업: Claude Code(`claude -p`)에게 넘김. Claude가 한도면 Claude 없이 기본 설정으로 채보함 | `POST /jobs`, `GET /jobs`, `GET /jobs/<id>`, `GET /jobs/<id>/result` |
| 내 악보: 구글 드라이브 `2.취미생활\우쿨렐레\악보` 폴더의 악보 목록·열기·저장(덮어쓸 때 이전판 폴더에 보관) | `GET /library`, `GET /library/<파일>`, `POST /library` |
| 로그인과 게임 기록: `2.취미생활\우쿨렐레\기록` 폴더(users.json, sessions.json, results/<아이디>.json) | `POST /auth/signup·login·logout·pin`, `POST /records/save·list` |

## 실행

- 작업 스케줄러 `\NuRILab\Ukulele-Bridge`가 로그온 때와 10분마다 `pythonw bridge.py`를 띄움(이미 떠 있으면 새로 뜬 것은 바로 끝남). 등록: `install_task.ps1`
- 토큰과 연결 링크: `python D:\codes\ukulele-tab\bridge\bridge.py --token`. 연결 링크를 브라우저에서 한 번 열면 페이지가 토큰을 저장함
- 로그: `logs/bridge.log`(이어 붙임). 마지막 작업이 실패하면 `logs/LAST_FAILURE.txt`가 생기고 성공하면 지워짐
- 다른 기기(아이패드 등): 작업 스케줄러 `\NuRILab\Ukulele-Tunnel`이 `tunnel.py`를 띄움(등록: `install_tunnel_task.ps1`). Cloudflare quick tunnel(계정 없음, 켤 때마다 주소가 바뀜)을 열고 주소를 공개 gist `bareblackfoot/59b3543199621afb77be5116e4c9bbd0`의 `uketab-backend.json`에 올림. 페이지는 이 PC 브리지에 못 닿으면 이 주소로 붙음. 1분마다 터널로 `/health`를 확인해 3번 연속 안 되면 다시 엶. 로그 `logs/tunnel.log`, 터널이 안 열려 있는 동안 `logs/TUNNEL_FAILURE.txt`

## 보안

- 127.0.0.1에서만 받음. 모든 요청에 토큰(`X-Bridge-Token`)이 필요하고, 브라우저 요청은 `https://bareblackfoot.github.io`와 localhost 페이지에서 온 것만 받음
- 채보 요청은 영상 ID(11자)와 정해진 옵션만 받아서 Claude에게 고정된 지시문으로 넘김. Claude는 이 폴더의 `transcribe.py`·`lyrics_tool.py`만 실행할 수 있고 작업 폴더 안에서만 읽고 씀. 웹에서 가사를 퍼 오지 않음
- 터널로 온 요청(Cloudflare가 붙이는 `Cf-Ray`·`Cf-Connecting-Ip` 머리글로 가림)은 토큰 없이 로그인·로그아웃·PIN 바꾸기·기록·내 악보(주인 로그인 필요)만 됨. 채보 작업·토큰 받기(`/pair`)·가입은 막힘. 주소 하나당 1분 120번, 로그인 시도 1시간 20번까지
- PIN은 PBKDF2-SHA256(사용자마다 다른 소금값, 20만 번)으로만 저장. 5번 틀리면 15분, 하루 15번이면 24시간 잠금. 로그인 토큰은 SHA-256만 저장, 90일 만료

## 채보 파이프라인

`transcribe.py`: yt-dlp(Node를 JavaScript 실행기로, 403이면 mweb 방식으로 다시) → wav → nurilab 서버 `~/ukulele_transcribe/run.sh` → `server/analyze.py`
(demucs 분리, beat_this 박·마디, torchcrepe 노래 음높이, 코드 판정, faster-whisper 가사) → `result.json`.
`--grid`를 주면 박 추적 대신 주어진 박자 격자를 씀(`spred_to_uke.py`가 SPRED 악보의 격자를 넘김).

- `spred_to_uke.py`: SPRED(오타마톤) 악보의 멜로디 + 원곡에서 딴 코드·가사 → 우쿨렐레 악보
- `../tools/fav_build.py`: 좋아하는 곡을 초보자 악보 코드표(하루한장 우쿨렐레 등)에 맞춰 만들기
