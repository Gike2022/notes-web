from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from note_store import (
    create_note,
    delete_note,
    delete_version,
    get_note,
    list_notes,
    restore_version,
    save_note,
)

app = Flask(__name__)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/notes")
def api_list_notes():
    return jsonify({"notes": list_notes()})


@app.post("/api/notes")
def api_create_note():
    note = create_note()
    return jsonify({"note": note}), 201


@app.get("/api/notes/<note_id>")
def api_get_note(note_id: str):
    note = get_note(note_id)
    return jsonify({"note": note})


@app.put("/api/notes/<note_id>")
def api_save_note(note_id: str):
    payload = request.get_json(silent=True) or {}
    note = save_note(note_id, payload)
    return jsonify({"note": note})


@app.post("/api/notes/<note_id>/restore")
def api_restore_note_version(note_id: str):
    payload = request.get_json(silent=True) or {}
    version_id = payload.get("version_id", "")
    if not version_id:
        return jsonify({"error": "version_id is required"}), 400

    note = restore_version(note_id, version_id)
    return jsonify({"note": note})


@app.delete("/api/notes/<note_id>")
def api_delete_note(note_id: str):
    delete_note(note_id)
    return jsonify({"deleted_note_id": note_id})


@app.delete("/api/notes/<note_id>/versions/<version_id>")
def api_delete_note_version(note_id: str, version_id: str):
    note = delete_version(note_id, version_id)
    return jsonify({"note": note})


@app.errorhandler(FileNotFoundError)
def handle_not_found(error):
    return jsonify({"error": str(error)}), 404


@app.errorhandler(ValueError)
def handle_bad_request(error):
    return jsonify({"error": str(error)}), 400


@app.errorhandler(HTTPException)
def handle_http_exception(error: HTTPException):
    # Ensure the frontend always receives JSON, not HTML error pages.
    description = getattr(error, "description", None) or str(error)
    status_code = getattr(error, "code", 400) or 400
    return jsonify({"error": description}), status_code


@app.errorhandler(Exception)
def handle_unexpected_exception(error: Exception):
    return jsonify({"error": "服务器发生错误，请稍后重试"}), 500


if __name__ == "__main__":
    app.run(debug=True)
