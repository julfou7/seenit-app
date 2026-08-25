import urllib.request
import json

req = urllib.request.Request('https://api4.thetvdb.com/v4/login', data=json.dumps({'apikey':'003b4e7b-87b7-4756-b227-bb241093216f'}).encode('utf-8'), headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())['data']['token']

req2 = urllib.request.Request('https://api4.thetvdb.com/v4/series/281662/extended', headers={'Authorization': 'Bearer ' + token}) # Flash
resp2 = urllib.request.urlopen(req2)
data = json.loads(resp2.read())['data']
print("Franchises:", data.get('franchises'))
print("Lists:", [l['name'] for l in data.get('lists', [])])
