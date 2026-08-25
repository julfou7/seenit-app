import urllib.request
import json

req = urllib.request.Request('https://api4.thetvdb.com/v4/login', data=json.dumps({'apikey':'003b4e7b-87b7-4756-b227-bb241093216f'}).encode('utf-8'), headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())['data']['token']

req2 = urllib.request.Request('https://api4.thetvdb.com/v4/series/78804/extended', headers={'Authorization': 'Bearer ' + token}) # Doctor Who
resp2 = urllib.request.urlopen(req2)
data = json.loads(resp2.read())['data']
print("Franchises for Doctor who:", data.get('franchises'))

try:
    req3 = urllib.request.Request('https://api4.thetvdb.com/v4/series/281662/extended', headers={'Authorization': 'Bearer ' + token}) # Flash
    resp3 = urllib.request.urlopen(req3)
    data3 = json.loads(resp3.read())['data']
    print("Franchises for Flash:", data3.get('franchises'))
except Exception as e:
    pass
