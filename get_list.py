import urllib.request
import json
import urllib.parse

req = urllib.request.Request('https://api4.thetvdb.com/v4/login', data=json.dumps({'apikey':'003b4e7b-87b7-4756-b227-bb241093216f'}).encode('utf-8'), headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())['data']['token']

req2 = urllib.request.Request('https://api4.thetvdb.com/v4/lists/13/extended', headers={'Authorization': 'Bearer ' + token})
resp2 = urllib.request.urlopen(req2)
d2 = json.loads(resp2.read())['data']
print("List 13:", d2['name'])
for e in d2.get('entities', []):
    print("  -", e.get('movieId') or e.get('seriesId'))

print("---")
req3 = urllib.request.Request('https://api4.thetvdb.com/v4/lists/15298/extended', headers={'Authorization': 'Bearer ' + token})
resp3 = urllib.request.urlopen(req3)
d3 = json.loads(resp3.read())['data']
print("List 15298:", d3['name'])
for e in d3.get('entities', []):
    print("  -", e.get('movieId') or e.get('seriesId'))
