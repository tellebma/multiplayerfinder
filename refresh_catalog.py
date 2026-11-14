"""Fetch public Steam France prices, screenshots and official trailer manifests."""
import json, urllib.request, concurrent.futures, datetime, pathlib, time
from data_catalog import GAMES
ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / 'catalog.json'

def enrich(g, previous):
    out = dict(g)
    old = previous.get(g['id'], {})
    for k in ('price','priceInitial','discount','free','image','poster','movies','fetchedAt','release','platforms'):
        if k in old: out[k] = old[k]
    if not g['appid']:
        if g['id'] in ('league-of-legends','valorant'):
            # Official Riot product pages provide preview clips and artwork.
            import re, html
            try:
                with urllib.request.urlopen(g['source'],timeout=15) as r: page=r.read().decode()
                image_urls=list(dict.fromkeys(re.findall(r'https[^\s"<>]*?1920x1080[^\s"<>]*',page)))
                video_urls=list(dict.fromkeys(re.findall(r'https[^\s"<>]*?\.mp4[^\s"<>]*',page)))
                if image_urls:
                    url=html.unescape(image_urls[0]); assets=ROOT/'public'/'assets';assets.mkdir(exist_ok=True)
                    target=assets/f"{g['id']}-image.jpg"
                    if not target.exists():
                        with urllib.request.urlopen(url,timeout=15) as r:target.write_bytes(r.read())
                    out['image']=out['poster']=f'/assets/{target.name}'
                if video_urls:out['movies']=[{'name':'Aperçu officiel Riot Games','mp4':{'max':html.unescape(video_urls[0])}}]
                out['fetchedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
                out['mediaLabel']='APERÇU OFFICIEL · RIOT GAMES'
            except Exception as e:print(f"Riot media unavailable for {g['name']}: {type(e).__name__}",flush=True)
        return out
    try:
        url = f"https://store.steampowered.com/api/appdetails?appids={g['appid']}&cc=fr&l=french"
        req = urllib.request.Request(url, headers={'User-Agent':'JVFinder-local/1.0'})
        with urllib.request.urlopen(req, timeout=22) as r: response = json.load(r)
        d = response[str(g['appid'])]
        if not d.get('success'): return out
        d = d['data']; p = d.get('price_overview', {})
        out.update(free=d.get('is_free',False), image=d.get('header_image'),
                   poster=(d.get('screenshots') or [{}])[0].get('path_full') or d.get('header_image'),
                   movies=d.get('movies',[])[:3], fetchedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   release=d.get('release_date',{}), platforms=d.get('platforms',{}))
        assets=ROOT/'public'/'assets'; assets.mkdir(exist_ok=True)
        for field in ('image','poster'):
            if not out.get(field): continue
            target=assets/f"{g['id']}-{field}.jpg"
            try:
                if not target.exists():
                    req=urllib.request.Request(out[field],headers={'User-Agent':'JVFinder-local/1.0'})
                    with urllib.request.urlopen(req,timeout=12) as r: target.write_bytes(r.read())
                out[field]=f'/assets/{target.name}'
            except OSError: pass
        out['price'] = 0 if out['free'] else p.get('final',None)/100 if p.get('currency')=='EUR' and 'final' in p else None
        out['priceInitial'] = p.get('initial',0)/100 if p.get('currency')=='EUR' else None
        out['discount'] = p.get('discount_percent',0)
        # An announced title should remain out of the available-now deck.
        if out['release'].get('coming_soon') and not g.get('playtest'): out['unreleased']=True
    except Exception as e:
        print(f"Steam unavailable for {g['name']}: {type(e).__name__}", flush=True)
    return out

def refresh():
    try: previous={g['id']:g for g in json.loads(DATA.read_text(encoding='utf-8'))['games']}
    except (OSError,ValueError,KeyError): previous={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        games=list(pool.map(lambda g: enrich(g,previous), GAMES))
    result={'games':games,'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'region':'FR', 'currency':'EUR'}
    tmp=DATA.with_suffix('.tmp'); tmp.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8'); tmp.replace(DATA)
    print(f"{len(games)} games, {sum(bool(g.get('movies')) for g in games)} trailers, {sum(g.get('price') is not None for g in games)} prices",flush=True)
    return result
if __name__=='__main__': refresh()
