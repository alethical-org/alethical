python := if os_family() == "windows" { ".venv/Scripts/python.exe" } else { ".venv/bin/python" }

format:
  {{python}} scripts/dev.py format

lint:
  {{python}} scripts/dev.py lint

migrate:
  {{python}} scripts/dev.py migrate

up:
  {{python}} scripts/dev.py up

down:
  {{python}} scripts/dev.py down

pipeline-install target:
  {{python}} scripts/dev.py pipeline-install {{target}}

pipeline target *ARGS:
  {{python}} scripts/dev.py pipeline {{target}} {{ARGS}}

pipeline-work target:
  {{python}} scripts/dev.py pipeline-work {{target}}
