@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   人脸推理服务  (127.0.0.1:8002)
echo   用途：人脸登录、活体校验、模板比对
echo.
echo   启动后请保留本窗口。关闭窗口或 Ctrl+C 会停止服务。
echo   服务停止后人脸功能不可用，网站其它功能不受影响。
echo ============================================================
echo.

call npm run face:start

echo.
echo ------------------------------------------------------------
echo 正在确认服务状态：
call npm run face:status
echo ------------------------------------------------------------
echo.
echo 若上面显示 fetch failed，说明服务未启动成功，请检查：
echo   1. 是否执行过  npm run face:setup  （首次使用需要下载模型）
echo   2. .env.local 中 FACE_INFER_URL 是否为 http://127.0.0.1:8002
echo.
pause
