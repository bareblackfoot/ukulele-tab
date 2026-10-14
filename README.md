# 우쿨렐레 코드 악보

유튜브 영상에 맞춰 재생하는 우쿨렐레 코드·TAB 악보 웹앱. 위쪽 칸에 지금 코드와 다음 코드의 운지 그림(손가락 번호 포함)이 뜨고, 아래에 코드·가사 악보가 4마디씩 나온다.

- 페이지: https://bareblackfoot.github.io/ukulele-tab/
- 사용법: [help.html](help.html)
- 기타판: https://bareblackfoot.github.io/guitar-tab/ (저장소 bareblackfoot/guitar-tab). 같은 코드이고 `js/site.js`만 다름.
  여기서 고친 뒤 `python tools/build_guitar.py`로 `D:\codes\guitar-tab`을 다시 만들어 두 저장소를 같이 올림.
  내 악보의 기타판은 `node tools/to_guitar.mjs`가 만듦(소리는 그대로, 기타 운지가 가장 쉬운 카포, 멜로디 TAB은 기타 줄로).
- 오타마톤판: https://bareblackfoot.github.io/otamatone-tab/ (저장소 bareblackfoot/otamatone-tab). `python tools/build_otamatone.py`로 만듦.
  멜로디만 있는 악기라 악보는 SPRED처럼 음 높이 칸(`js/sheet.js` renderRoll), 게임은 음높이로 판정(`js/pitchgame.js`, 화면 `js/pitchlane.js`).
  코드·스트럼·카포·편집 화면은 숨김(`chord-only`). 도움말은 `tools/otamatone_help.html`. 내 악보는 SPRED 악보를 `node tools/to_otamatone.mjs <폴더>`로 넣음.

## 구성

| 경로 | 내용 |
|---|---|
| `index.html`, `css/`, `js/` | 웹앱 (빌드 없음, ES modules) |
| `js/model.js` | 악보 형식 `ukulele-sheet` v1, 시간 계산, SPRED·자동 채보 결과 가져오기 |
| `js/instrument.js`, `js/site.js` | 악기(우쿨렐레·기타·오타마톤)와 튜닝, 이 사이트가 어느 악기인지 |
| `js/chords.js` | 코드 이름 해석, 코드 모양(우쿨렐레 G C E A, 기타 낮은 E부터)과 손가락 번호, 쉬운 카포 |
| `js/fingering.js` | 멜로디 음높이 → 줄·프렛 |
| `examples/` | 저작권이 끝난 곡으로 만든 예제 (`node tools/make_examples.mjs`로 다시 만듦) |
| `bridge/` | 이 PC에서 도는 연결 프로그램과 자동 채보 (`bridge/README.md`) |
| `tests/` | `npm test` (계산 부분), `python tests/smoke.py <주소> <폴더>` (화면) |

## 악보 형식 (ukulele-sheet v1)

시간은 칸(column) 단위이고 `stepsPerBeat` 칸이 한 박이다. 튜닝 이름이 악기를 정한다(`standard`·`low-g` 우쿨렐레, `guitar`·`guitar-drop-d` 기타, `otamatone` 오타마톤).
오타마톤은 줄이 하나인 것으로 다룬다: 줄 0의 「프렛」 n이 E3 + n 반음(SPRED 음역 E3~C#6).
줄 번호는 우쿨렐레 0..3 = G, C, E, A, 기타 0..5 = 낮은 E, A, D, G, B, 높은 E. 다른 악기 악보를 열면 그 사이트 악기로 옮겨서 연다.

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
