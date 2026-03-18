#!/bin/bash

# Запуск Node.js приложения внутри виртуального графического сервера (Xvfb)
# Это обманет Playwright, и он сможет открыть Chromium так, как будто к серверу подключен монитор (разрешение 1280x1024).

xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x24" node server.js
