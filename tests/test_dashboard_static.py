from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_static_dashboard_supports_live_server_and_public_demo() -> None:
    html = (ROOT / "dashboard" / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "dashboard" / "app.js").read_text(encoding="utf-8")
    demo = (ROOT / "dashboard" / "demo-data.js").read_text(encoding="utf-8")

    assert './assets/app.js' in html
    assert './assets/demo-data.js' in html
    assert "github.io" in app
    assert "FINOPS_DEMO_SESSIONS" in app
    assert "prompt_text" not in demo.lower()
    assert "response_text" not in demo.lower()
    assert "file_path" not in demo.lower()
