"""Local-only, dependency-free JVFinder server."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json, argparse, threading, urllib.parse
from refresh_catalog import refresh
ROOT=Path(__file__).resolve().parent
refresh_lock=threading.Lock()
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(ROOT/'public'),**kw)
    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == '/api/games':
            data=(ROOT/'catalog.json').read_bytes()
            self.send_response(200); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(data)
        else: super().do_GET()
    def do_POST(self):
        if self.path!='/api/refresh': self.send_error(404); return
        origin=self.headers.get('Origin')
        if origin and origin != 'http://'+self.headers.get('Host',''): self.send_error(403); return
        if not refresh_lock.acquire(False): self.send_error(409,'Refresh already running'); return
        try:
            data=json.dumps(refresh(),ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type','application/json; charset=utf-8'); self.end_headers(); self.wfile.write(data)
        finally: refresh_lock.release()
if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=8765); args=parser.parse_args()
    if not (ROOT/'catalog.json').exists(): refresh()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'JVFinder: http://localhost:{args.port}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
