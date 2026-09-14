"""/cli 入口测试（直接调用 main，覆盖参数解析与退出码）。"""

import pytest

from ops_agent.cli import main


def test_show_permission(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--show-permission"]) == 0
    out = capsys.readouterr().out
    assert "L1" in out and "L2" in out and "L3" in out


def test_check_command_allowed(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--check-command", "df -h"]) == 0
    assert "允许" in capsys.readouterr().out


def test_check_command_denied(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--check-command", "rm -rf /"]) == 2
    out = capsys.readouterr().out
    assert "拒绝" in out and "L1" in out


def test_dry_run_end_to_end(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    log = tmp_path / "s.jsonl"
    code = main(
        [
            "--adapter",
            "mock",
            "--host",
            "demo-host",
            "--dry-run",
            "--session-log",
            str(log),
            "-p",
            "看看磁盘",
            "--quiet",
        ]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert "诊断完成" in out
    assert log.exists()


def test_missing_host_is_rejected(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        main(["-p", "看看磁盘"])
