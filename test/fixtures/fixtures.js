/*
 * Nova Debug — test/preview.js 픽스처 선택기(?fixture=) 용 추가 픽스처 모음.
 * sample.json 은 fixtures/sample.js(window.__novaDebugSample)가 기존 방식 그대로 담당하고,
 * 이 파일은 그 외 픽스처를 window.__novaDebugFixtures[name] 에 등록한다(file:// 오픈 시 fetch() CORS 회피 목적은 sample.js 와 동일).
 */
window.__novaDebugFixtures = window.__novaDebugFixtures || {};
window.__novaDebugFixtures["unknown-type"] = {
  "schemaVersion": 2,
  "meta": {
    "id": "260717_000000_0000000000000000",
    "generator": "nova-debug/20260717",
    "request": {
      "uri": "/?debug=on",
      "date": "2026-07-17T00:00:00+09:00"
    },
    "runtime": {
      "name": "php",
      "version": "8.5.1"
    },
    "dirRoot": "/home/www/nova_builder",
    "transport": {
      "cookieName": "DO",
      "cookieOn": false
    }
  },
  "summary": {
    "time": {
      "total": 0.05,
      "debug": 0.001
    },
    "memory": {
      "usage": 1000000,
      "peak": 1000000
    },
    "queries": {
      "count": 0,
      "time": 0,
      "slow": {
        "count": 0,
        "time": 0
      },
      "dup": {
        "total": 0,
        "patterns": 0,
        "percent": 0
      },
      "loop": {
        "total": 0,
        "sites": 0,
        "byType": []
      },
      "avg": 0,
      "max": 0,
      "maxIndex": 0
    },
    "files": {
      "count": 1
    }
  },
  "thresholds": {
    "slowQueryTime": 0.01,
    "tooManyCount": 50
  },
  "files": [
    {
      "path": "/public/index.php"
    }
  ],
  "frames": [
    {
      "file": 0,
      "line": 1,
      "func": "main",
      "args": "",
      "argsFull": ""
    }
  ],
  "entries": [
    {
      "index": 0,
      "type": "dump",
      "time": 0,
      "duration": 0,
      "label": "IP",
      "dump": "192.168.65.1",
      "trace": [
        0
      ]
    },
    {
      "index": 1,
      "type": "cache",
      "time": 0.001,
      "duration": 0,
      "label": "CACHE",
      "dump": "hit",
      "trace": [
        0
      ],
      "cache": {}
    }
  ],
  "timeline": [
    {
      "name": "START",
      "start": 0,
      "duration": 0.05
    }
  ],
  "x-php": {
    "opcache": true
  }
};
window.__novaDebugFixtures["explain-formats"] = {
  "schemaVersion": 2,
  "meta": {
    "id": "260717_000000_0000000000000001",
    "generator": "nova-debug/20260717",
    "request": {
      "uri": "/?debug=on",
      "date": "2026-07-17T00:00:00+09:00"
    },
    "runtime": {
      "name": "php",
      "version": "8.5.1"
    },
    "dirRoot": "/home/www/nova_builder",
    "transport": {
      "cookieName": "DO",
      "cookieOn": false
    }
  },
  "summary": {
    "time": {
      "total": 0.05,
      "debug": 0.001
    },
    "memory": {
      "usage": 1000000,
      "peak": 1000000
    },
    "queries": {
      "count": 4,
      "time": 0.01,
      "slow": {
        "count": 0,
        "time": 0
      },
      "dup": {
        "total": 0,
        "patterns": 0,
        "percent": 0
      },
      "loop": {
        "total": 0,
        "sites": 0,
        "byType": []
      },
      "avg": 0.0025,
      "max": 0.005,
      "maxIndex": 0
    },
    "files": {
      "count": 1
    }
  },
  "thresholds": {
    "slowQueryTime": 0.01,
    "tooManyCount": 50
  },
  "files": [
    {
      "path": "/public/index.php"
    }
  ],
  "frames": [
    {
      "file": 0,
      "line": 1,
      "func": "main",
      "args": "",
      "argsFull": ""
    }
  ],
  "entries": [
    {
      "index": 0,
      "type": "query",
      "time": 0.001,
      "duration": 0.0025,
      "label": "QUERY",
      "dump": "SELECT * FROM menu WHERE id = 1",
      "trace": [0],
      "query": {
        "table": "menu",
        "warn": false,
        "explain": {
          "format": "table",
          "columns": ["id", "select_type", "table", "type", "possible_keys", "key", "key_len", "ref", "rows", "Extra"],
          "rows": [
            [1, "SIMPLE", "menu", "const", "PRIMARY", "PRIMARY", 4, "const", 1, null]
          ]
        }
      }
    },
    {
      "index": 1,
      "type": "query",
      "time": 0.002,
      "duration": 0.003,
      "label": "QUERY",
      "dump": "SELECT * FROM users WHERE email = 'a@b.com'",
      "trace": [0],
      "query": {
        "table": "users",
        "warn": true,
        "explain": {
          "format": "text",
          "text": "Seq Scan on users  (cost=0.00..18.50 rows=850 width=97)\n  Filter: (email = 'a@b.com'::text)"
        }
      }
    },
    {
      "index": 2,
      "type": "query",
      "time": 0.003,
      "duration": 0.005,
      "label": "QUERY",
      "dump": "SELECT * FROM orders WHERE status = 'paid'",
      "trace": [0],
      "query": {
        "table": "orders",
        "warn": false,
        "explain": {
          "format": "json",
          "json": [
            {
              "Plan": {
                "Node Type": "Seq Scan",
                "Relation Name": "orders",
                "Total Cost": 20.5,
                "Plan Rows": 100
              }
            }
          ]
        }
      }
    },
    {
      "index": 3,
      "type": "query",
      "time": 0.004,
      "duration": 0.0025,
      "label": "QUERY",
      "dump": "SELECT * FROM menu WHERE parent_id = 1",
      "trace": [0],
      "query": {
        "table": "menu",
        "warn": false,
        "explainHtml": "<table><tr><td>SIMPLE</td><td>menu</td></tr></table>",
        "explain": {
          "format": "table",
          "columns": ["id", "select_type", "table", "type", "possible_keys", "key", "key_len", "ref", "rows", "Extra"],
          "rows": [
            [4, "SIMPLE", "menu", "ref", "idx_parent", "idx_parent", "4", "const", "3", "Using where"]
          ]
        }
      }
    }
  ],
  "timeline": [
    {
      "name": "START",
      "start": 0,
      "duration": 0.05
    }
  ],
  "x-php": {
    "opcache": true
  }
};
window.__novaDebugFixtures["log-exception"] = {
  "schemaVersion": 2,
  "meta": {
    "id": "260717_000000_0000000000000002",
    "generator": "nova-debug/20260717",
    "request": {
      "uri": "/?debug=on",
      "date": "2026-07-17T00:00:00+09:00"
    },
    "runtime": {
      "name": "php",
      "version": "8.5.1"
    },
    "dirRoot": "/home/www/nova_builder",
    "transport": {
      "cookieName": "DO",
      "cookieOn": false
    }
  },
  "summary": {
    "time": {
      "total": 0.05,
      "debug": 0.001
    },
    "memory": {
      "usage": 1000000,
      "peak": 1000000
    },
    "queries": {
      "count": 0,
      "time": 0,
      "slow": {
        "count": 0,
        "time": 0
      },
      "dup": {
        "total": 0,
        "patterns": 0,
        "percent": 0
      },
      "loop": {
        "total": 0,
        "sites": 0,
        "byType": []
      },
      "avg": 0,
      "max": 0,
      "maxIndex": 0
    },
    "files": {
      "count": 1
    },
    "logs": {
      "count": 8,
      "byLevel": {
        "debug": 1,
        "info": 1,
        "notice": 1,
        "warning": 1,
        "error": 1,
        "critical": 1,
        "alert": 1,
        "emergency": 1
      }
    }
  },
  "thresholds": {
    "slowQueryTime": 0.01,
    "tooManyCount": 50
  },
  "files": [
    {
      "path": "/public/index.php"
    },
    {
      "path": "/app/services/PaymentService.php"
    },
    {
      "path": "/app/services/GatewayClient.php"
    },
    {
      "path": "/vendor/pdo/Connection.php"
    }
  ],
  "frames": [
    {
      "file": 0,
      "line": 1,
      "func": "main",
      "args": "",
      "argsFull": ""
    },
    {
      "file": 1,
      "line": 42,
      "func": "PaymentService::charge",
      "args": "(1000)",
      "argsFull": "(amount: 1000)"
    },
    {
      "file": 2,
      "line": 88,
      "func": "GatewayClient::send",
      "args": "(...)",
      "argsFull": "(payload: array(3))"
    },
    {
      "file": 3,
      "line": 15,
      "func": "Connection::exec",
      "args": "(...)",
      "argsFull": "(sql: 'INSERT ...')"
    }
  ],
  "entries": [
    {
      "index": 0,
      "type": "log",
      "time": 0.001,
      "duration": 0,
      "label": "LOG",
      "dump": "Cache warmed for key 'menu.tree'",
      "trace": [0],
      "log": { "level": "debug" }
    },
    {
      "index": 1,
      "type": "log",
      "time": 0.002,
      "duration": 0,
      "label": "LOG",
      "dump": "User 42 logged in",
      "trace": [0],
      "log": { "level": "info", "context": { "userId": 42 } }
    },
    {
      "index": 2,
      "type": "log",
      "time": 0.003,
      "duration": 0,
      "label": "LOG",
      "dump": "Deprecated config key 'old_key' still in use",
      "trace": [0],
      "log": { "level": "notice" }
    },
    {
      "index": 3,
      "type": "log",
      "time": 0.004,
      "duration": 0,
      "label": "LOG",
      "dump": "Gateway response slower than expected (2.1s)",
      "trace": [0, 1],
      "log": { "level": "warning", "context": { "elapsed": 2.1 } }
    },
    {
      "index": 4,
      "type": "log",
      "time": 0.005,
      "duration": 0,
      "label": "LOG",
      "dump": "Payment charge failed: gateway timeout",
      "trace": [0, 1, 2],
      "log": { "level": "error", "context": { "orderId": 991 } }
    },
    {
      "index": 5,
      "type": "log",
      "time": 0.006,
      "duration": 0,
      "label": "LOG",
      "dump": "Database connection pool exhausted",
      "trace": [0, 3],
      "log": { "level": "critical" }
    },
    {
      "index": 6,
      "type": "log",
      "time": 0.007,
      "duration": 0,
      "label": "LOG",
      "dump": "Disk usage above 95% on /var/log",
      "trace": [0],
      "log": { "level": "alert" }
    },
    {
      "index": 7,
      "type": "log",
      "time": 0.008,
      "duration": 0,
      "label": "LOG",
      "dump": "Application unable to reach primary database",
      "trace": [0],
      "log": { "level": "emergency" }
    },
    {
      "index": 8,
      "type": "exception",
      "time": 0.009,
      "duration": 0,
      "label": "EXCEPTION",
      "dump": "PaymentGatewayException: Gateway rejected transaction",
      "trace": [0, 1, 2],
      "exception": {
        "class": "App\\Payment\\PaymentGatewayException",
        "message": "Gateway rejected transaction",
        "code": "GATEWAY_REJECTED",
        "file": 2,
        "line": 88,
        "trace": [0, 1, 2],
        "previous": {
          "class": "PDOException",
          "message": "SQLSTATE[HY000]: General error: 1205 Lock wait timeout exceeded",
          "code": "HY000",
          "file": 3,
          "line": 15,
          "trace": [0, 1, 2, 3],
          "previous": {
            "class": "RuntimeException",
            "message": "Connection reset by peer",
            "code": 0,
            "file": null,
            "line": null,
            "trace": []
          }
        }
      }
    }
  ],
  "timeline": [
    {
      "name": "START",
      "start": 0,
      "duration": 0.05
    }
  ],
  "x-php": {
    "opcache": true
  }
};
window.__novaDebugFixtures["query-bindings"] = {
  "schemaVersion": 2,
  "meta": {
    "id": "260720_000000_0000000000000007",
    "generator": "nova-debug/20260720",
    "request": {
      "uri": "/?debug=on",
      "date": "2026-07-20T00:00:00+09:00"
    },
    "runtime": {
      "name": "php",
      "version": "8.5.1"
    },
    "dirRoot": "/home/www/nova_builder",
    "transport": {
      "cookieName": "DO",
      "cookieOn": false
    }
  },
  "summary": {
    "time": {
      "total": 0.05,
      "debug": 0.001
    },
    "memory": {
      "usage": 1000000,
      "peak": 1000000
    },
    "queries": {
      "count": 2,
      "time": 0.006,
      "slow": {
        "count": 0,
        "time": 0
      },
      "dup": {
        "total": 0,
        "patterns": 0,
        "percent": 0
      },
      "loop": {
        "total": 0,
        "sites": 0,
        "byType": []
      },
      "avg": 0.003,
      "max": 0.004,
      "maxIndex": 1
    },
    "files": {
      "count": 1
    }
  },
  "thresholds": {
    "slowQueryTime": 0.01,
    "tooManyCount": 50
  },
  "files": [
    {
      "path": "/public/index.php"
    }
  ],
  "frames": [
    {
      "file": 0,
      "line": 1,
      "func": "main",
      "args": "",
      "argsFull": ""
    }
  ],
  "entries": [
    {
      "index": 0,
      "type": "query",
      "time": 0.001,
      "duration": 0.002,
      "label": "QUERY",
      "dump": "SELECT * FROM users WHERE id = ? AND status = ?",
      "trace": [0],
      "query": {
        "table": "users",
        "connection": "default",
        "bindings": [42, "active"]
      }
    },
    {
      "index": 1,
      "type": "query",
      "time": 0.003,
      "duration": 0.004,
      "label": "QUERY",
      "dump": "SELECT * FROM logs WHERE created_at > ? AND deleted_at IS ?",
      "trace": [0],
      "query": {
        "table": "logs",
        "connection": "mysql_read",
        "bindings": ["2026-07-01 00:00:00", null]
      }
    },
    {
      "index": 2,
      "type": "dump",
      "time": 0.004,
      "duration": 0,
      "label": "RESPONSE BODY",
      "dump": "{\"id\":42,\"name\":\"daddy\", ... (truncated)",
      "trace": [0],
      "truncated": true
    }
  ],
  "timeline": [
    {
      "name": "START",
      "start": 0,
      "duration": 0.05
    }
  ],
  "x-php": {
    "opcache": true
  }
};
window.__novaDebugFixtures["minimal-optional"] = {
  "schemaVersion": 2,
  "meta": {
    "id": "260720_000000_0000000000000003",
    "generator": "nova-debug/20260720",
    "runtime": {
      "name": "php",
      "version": "8.5.1"
    },
    "dirRoot": "/home/www/nova_builder"
  },
  "summary": {
    "time": {
      "total": 0.02,
      "debug": 0.0005
    },
    "memory": {
      "usage": 500000,
      "peak": 500000
    }
  },
  "thresholds": {
    "slowQueryTime": 0.01,
    "tooManyCount": 50
  },
  "files": [
    {
      "path": "/public/index.php"
    }
  ],
  "frames": [
    {
      "file": 0,
      "line": 1,
      "func": "main",
      "args": "",
      "argsFull": ""
    },
    {
      "file": null,
      "line": null,
      "func": "{closure}",
      "args": "",
      "argsFull": ""
    }
  ],
  "entries": [
    {
      "index": 0,
      "type": "query",
      "time": 0.001,
      "duration": 0.0005,
      "label": "QUERY",
      "dump": "SELECT 1 FROM cache_store",
      "trace": [1],
      "query": {}
    }
  ],
  "timeline": [
    {
      "name": "START",
      "start": 0,
      "duration": 0.02
    }
  ],
  "x-custom": {
    "note": "임의 벤더 확장 키 — x-nova/x-php 외에도 루트 x-* 패턴 전체가 허용됨을 실증"
  }
};
