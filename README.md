# 우쿨렐레 코드 악보

유튜브 영상에 맞춰 재생하는 우쿨렐레 코드·TAB 악보 웹앱. 위쪽 칸에 지금 코드와 다음 코드의 운지 그림(손가락 번호 포함)이 뜨고, 아래에 코드·가사 악보가 4마디씩 나온다.

- 페이지: https://bareblackfoot.github.io/ukulele-tab/
- 사용법: [help.html](help.html)

## 구성

| 경로 | 내용 |
|---|---|
| `index.html`, `css/`, `js/` | 웹앱 (빌드 없음, ES modules) |
| `js/model.js` | 악보 형식 `ukulele-sheet` v1, 시간 계산, SPRED·자동 채보 결과 가져오기 |
| `js/chords.js` | 코드 이름 해석, 우쿨렐레 코드 모양(G C E A 순서)과 손가락 번호 |
| `js/fingering.js` | 멜로디 음높이 → 줄·프렛 |
| `examples/` | 저작권이 끝난 곡으로 만든 예제 (`node tools/make_examples.mjs`로 다시 만듦) |
| `bridge/` | 이 PC에서 도는 연결 프로그램과 자동 채보 (`bridge/README.md`) |
| `tests/` | `npm test` (계산 부분), `python tests/smoke.py <주소> <폴더>` (화면) |

## 악보 형식 (ukulele-sheet v1)

시간은 칸(column) 단위이고 `stepsPerBeat` 칸이 한 박이다. 줄 번호는 0..3 = G, C, E, A.

```json
{
  "format": {"name": "ukulele-sheet", "version": 1},
  "meta": {"title": "", "artist": "", "key": "C"},
  "tuning": "standard",
  "stepsPerBeat": 4, "columnCount": 256,
  "tempo": [{"col": 0, "bpm": 100}], "meter": [{"col": 0, "beats": 4}],
  "youtube": {"videoId": "", "offsetMs": 0},
  "strum": {"pattern": "D-DU-UDU"},
  "sections": [{"col": 0, "text": "A"}],
  "chords": [{"col": 0, "name": "C"}],
  "lyrics": [{"col": 0, "text": "가"}],
  "tracks": [{"id": "melody", "name": "멜로디", "notes": [{"col": 0, "len": 2, "string": 3, "fret": 3}]}],
  "chordShapes": {"C": "0003"}
}
```

YouTube 싱크 규칙은 SPRED와 같다: 영상 시각 = 악보 시각 − offsetMs/1000.
