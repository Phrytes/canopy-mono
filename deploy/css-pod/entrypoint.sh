#!/bin/sh
# Community Solid Server launcher — assembles the CLI from env.
#
#   CSS_CONFIG          @css:config/file.json  (WAC)  |  @css:config/file-acp.json (ACP)
#   CSS_ROOT_FILE_PATH  persistent storage dir (mount a volume)
#   CSS_BASE_URL        MUST equal the public URL (WebIDs bake this in)
#   CSS_PORT / PORT     listen port (PaaS injects PORT)
set -eu

PORT_TO_USE="${PORT:-${CSS_PORT:-3000}}"

echo "Community Solid Server"
echo "  config:   ${CSS_CONFIG}"
echo "  baseUrl:  ${CSS_BASE_URL}"
echo "  storage:  ${CSS_ROOT_FILE_PATH}"
echo "  port:     ${PORT_TO_USE}"

exec community-solid-server \
  -c "${CSS_CONFIG}" \
  -f "${CSS_ROOT_FILE_PATH}" \
  -b "${CSS_BASE_URL}" \
  -p "${PORT_TO_USE}" \
  -l "${CSS_LOG_LEVEL:-info}"
