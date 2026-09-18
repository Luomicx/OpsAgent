// Windows 下隐藏控制台窗口（release 构建生效）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ops_agent_desktop_lib::run()
}
