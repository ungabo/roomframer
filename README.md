# Wall Framing Designer

Wall Framing Designer is a web app for laying out a framed wall elevation,
adding doors and windows, and having the framing members update automatically.
It runs a FastAPI backend with a vanilla JavaScript frontend and stores saved
projects in a SQLite database.

## What It Does

- Draws a single wall elevation in 2D
- Places plates, kings, jacks, studs, headers, sills, and cripples automatically
- Lets you drag doors and windows horizontally with snap-to-1/16 inch behavior
- Supports feet/inches or decimal-inch entry and display
- Saves projects and presets in SQLite
- Produces a print-friendly plan with dimensions, legend, cut list, and warnings

## Tech Stack

- Backend: Python 3.11+, FastAPI, SQLite
- Frontend: HTML, CSS, vanilla JavaScript, HTML5 Canvas
- Build tooling: none required

## Requirements

Before you start, make sure you have:

- Python 3.11 or newer installed
- `pip` available
- A modern web browser

## Installation

### Windows

From the project root:

```bat
cd d:\path\to\designer
py -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
```

### macOS / Linux

From the project root:

```bash
cd /path/to/designer
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
```

## Running The App

Start the backend from the project root:

```bat
python backend\run.py
```

The backend serves the frontend directly, so there is no separate frontend dev
server and no Node install step.

## Python Packages

The backend requirements are defined in `backend/requirements.txt`. The current
required Python packages are:

- `fastapi>=0.110`
- `uvicorn[standard]>=0.29`
- `pydantic>=2.6`

Install them with:

```bat
pip install -r backend\requirements.txt
```

## Database And Saved Data

- The app uses SQLite
- The database file is `data/designer.db`
- The `data` folder is created automatically if it does not exist
- The database schema is applied automatically on first startup
- Default framing presets and opening presets are seeded automatically when the
  preset tables are empty
- There is currently no database username/password or app login system

This means a fresh clone can be started immediately after installing Python
dependencies. The DB is created the first time the backend imports the database
module during app startup.

## Resetting The App Data

To reset all saved projects and reseed defaults:

1. Stop the server.
2. Delete `data/designer.db`.
3. Start the app again with `python backend\run.py`.

The app will recreate the database automatically.

## Project Layout

```text
designer/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── db.py
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── routes.py
│   │   └── schema.sql
│   ├── requirements.txt
│   └── run.py
├── data/
├── frontend/
│   ├── index.html
│   ├── plan_preview.html
│   ├── css/
│   └── js/
├── reference/
└── tests/
```

## How To Use The App

1. Open the app in your browser.
2. Choose a framing preset, or enter stud size, spacing, and plate settings manually.
3. Enter the wall length and wall height.
4. Add an opening by choosing a preset or creating a generic door/window.
5. Click an opening to select it.
6. Drag it left or right on the canvas, or edit its values in the selected opening controls.
7. Review the framing layout, dimensions, cut list, and warnings as they update.
8. Save the project when you want to keep the current design.
9. Use the print view when you want a dimensioned output sheet.

## Measurement Input

Measurement fields accept common framing-style formats and normalize them after
editing. Examples:

- `8'`
- `8 ft`
- `8' 6"`
- `8'6"`
- `8 ft 6 in`
- `8' 6 1/2"`
- `8-6`
- `102`
- `102.5`
- `102 1/2"`

Internally, the app stores lengths in decimal inches and snaps displayed values
to 1/16 inch. You can switch between:

- Feet and inches, for example `8'-6 1/2"`
- Decimal inches, for example `102.5"`

## Keyboard Shortcuts

- `Ctrl+Z`: Undo
- `Ctrl+Y`: Redo
- `Delete`: Remove the selected opening

## HTTP API Summary

The browser UI talks to these backend endpoints under `/api`:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{id}`
- `PUT /api/projects/{id}`
- `DELETE /api/projects/{id}`
- `GET /api/presets/framing`
- `POST /api/presets/framing`
- `DELETE /api/presets/framing/{id}`
- `GET /api/presets/openings`
- `POST /api/presets/openings`
- `DELETE /api/presets/openings/{id}`

## Troubleshooting

### The app will not start

- Confirm the virtual environment is activated
- Confirm dependencies were installed from `backend/requirements.txt`
- Make sure Python is 3.11+

### Projects are not being saved

- Confirm the app can write to the project folder
- Confirm the `data` folder and `data/designer.db` file can be created
- Check whether the DB file was deleted or locked by another process

## Development Notes

- Static frontend files are served by FastAPI from the `frontend` folder
- SQLite initialization happens on import in `backend/app/db.py`

## Roadmap

- Overhead plan and multi-wall layout
- DXF, OBJ, or SVG export expansion
- 3D/orbit view
- Sheathing sheet layout
- Per-wall schedules and combined project print output
