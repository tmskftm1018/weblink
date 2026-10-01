# 프로젝트 파일을 SQLite로 가져오기

프로젝트에 추가한 UTF-8 CSV 또는 JSON 파일을 해당 프로젝트의 영구 SQLite 데이터베이스로 가져올 수 있다. 실행 컨테이너는 프로젝트 파일을 `/workspace`에서 읽고, 프로젝트별 DB를 `/data/students.db`에 저장한다.

## CSV 가져오기

예를 들어 프로젝트에 `data/books.csv` 파일이 있고 첫 행이 열 이름이라고 가정한다.

```csv
title,author,year
불편한 편의점,김호연,2021
아몬드,손원평,2017
```

`main.py`에서 다음처럼 실행한다.

```python
import sqlite3
from weblink_api import import_csv_to_sqlite

connection = sqlite3.connect("/data/students.db")
result = import_csv_to_sqlite(connection, "data/books.csv", "books")
print(f"{result['row_count']}개 행 가져옴: {result['table_name']}")

rows = connection.execute("SELECT title, author, year FROM books").fetchall()
print(rows)
connection.close()
```

CSV 헤더는 SQLite 열 이름으로 안전하게 정리한다. 영문·숫자·밑줄 외 문자는 밑줄로 바꾸고, 빈 이름은 `column_번호`로 채우며, 중복 이름에는 번호를 덧붙인다. 열 값은 TEXT로 저장한다.

## JSON 가져오기

JSON은 객체 배열이어야 한다. 각 객체는 행 하나가 된다.

```json
[
  {"title": "불편한 편의점", "author": "김호연", "year": 2021},
  {"title": "아몬드", "author": "손원평", "year": 2017}
]
```

```python
import sqlite3
from weblink_api import import_json_to_sqlite

connection = sqlite3.connect("/data/students.db")
result = import_json_to_sqlite(connection, "data/books.json", "books")
print(result)
connection.close()
```

## 적용 범위와 안전 장치

- 파일은 프로젝트 폴더 안의 상대 경로로 지정하며, CSV/JSON 파일은 200KB 이하, 가져올 행은 10,000개 이하, 열은 256개 이하로 제한한다.
- 테이블 이름은 영문자로 시작하는 영문·숫자·밑줄만 허용한다. 파일에서 가져온 열 이름은 SQL 식별자로 안전하게 변환한다.
- JSON의 중첩된 객체와 배열은 JSON 문자열로 저장한다. 각 행의 열이 다르면 전체 행에 등장한 열 이름을 모아 빈 값은 NULL로 둔다.
- 대상 테이블이 이미 있으면 파일 행으로 전체 내용을 교체한다. 기존 열 구성이 다르거나 데이터 검증/삽입에 실패하면 트랜잭션을 되돌린다.
- 프로젝트 파일은 읽기 전용 실행 공간에 있어 원본 CSV/JSON은 바뀌지 않는다. 데이터베이스 쓰기는 명시적으로 함수를 호출했을 때만 발생한다.

이 기능은 실행 런타임에 추가했으며 컨테이너 재빌드와 프로젝트별 CSV/JSON 수동 확인은 아직 하지 않았다.
