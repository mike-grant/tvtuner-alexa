const express = require('express');
const app = express();
const adb = require('@devicefarmer/adbkit').Adb;
const trakt = require('trakt.tv');
const justwatch = require('justwatch-api');
const Trakt = new trakt({
  client_id: "",
  client_secret: "",
  redirect_uri: "",
});
const JustWatch = new justwatch({ locale: 'en_GB' });
app.use(express.json());

const client = adb.createClient({
  host: '127.0.0.1',
  port: '5037'
})

const devices = [{
  "id": "192.168.1.1",
  "friendlyName": "Office TV",
  "type": "firetv"
}]

const convertImdb = async (imdb) => {
  var id = await Trakt.search.id({
    id_type: 'imdb',
    id: imdb,
  });
  return id[0].show;
}

const justWatchSearch = async (data) => {
  const providers = ['al4', 'amp', 'bbc', 'dnp', 'nfx', 'itv']; //All4, Prime Video, BBC iPlayer, Disney+, Netflix, ITVX
  const monetization_types = ['flatrate', 'free'];
  const params = {
    query: data.title,
    providers: providers,
    monetization_types: monetization_types,
    content_types: ['show'],
  };
  const shows = await JustWatch.search(params);
  const show = shows.items.find((item) => {
    return item.object_type == 'show' &&
      item.original_release_year == data.year
  });
  const episodes = await JustWatch.getEpisodes(show.id);
  const offer = episodes.items[0].offers.find((item) => {
    return x => providers.includes(x.package_short_name) && monetization_types.includes(x.monetization_type)
  })
  return offer;
}

const playContent = async (imdb, target) => {
  var contentData = await convertImdb(imdb);
  var justWatchContent = await justWatchSearch(contentData);
  var targetDevice = devices.find(x => x.id == target);
  let deeplink;
  if (targetDevice.type == "firetv") {
    deeplink = justWatchContent.urls.deeplink_fire_tv;
  } else {
    deeplink = justWatchContent.urls.deeplink_android_tv;
  }
  if (target) {
    const deviceClient = await client.getDevice(targetDevice.id);
    const deeplinkCommand = await deviceClient.shell(
      `input keyevent 3 && am start -W ${deeplink}`
    );
  }
}

app.post('/', async (req, res) => {
  const event = req.body;
  const directive = event.directive;
  if (directive) {
    if (directive.header.name == 'Discover') {
      console.log('Discover Request received from Alexa');
      const alexaEndpoints = devices.map(x => ({
        displayCategories: ['TV'],
        capabilities: [
          {
            interface: 'Alexa.RemoteVideoPlayer',
            type: 'AlexaInterface',
            version: '1.0',
          },
        ],
        endpointId: `tvtuner#${x.id}`,
        description: `${x.friendlyName} by TVTuner`,
        friendlyName: `${x.friendlyName} TVTuner`,
        manufacturerName: 'tvtuner',
      }));
      // A discovery response that includes two devices. Alexa will show these devices to customers.
      const resp = {
        event: {
          header: {
            messageId: directive.header.messageId,
            name: 'Discover.Response',
            namespace: 'Alexa.Discovery',
            payloadVersion: '3',
          },
          payload: {
            endpoints: alexaEndpoints,
          },
        },
      };
      res.send(resp);
      return;
    }
    if (directive.header.name == 'SearchAndPlay') {
      const imdb = directive.payload.entities[0].externalIds.imdb;
      const target = directive.endpoint.endpointId.replace('tvtuner#', '');
      const data = playContent(imdb, target);
      const resp = {
        event: {
          endpoint: {
            scope: {
              type: 'DirectedUserId',
              directedUserId: 'some-Amazon-user-id',
            },
            endpointId: directive.endpoint.endpointId,
          },
          header: {
            messageId: directive.header.messageId,
            name: 'Response',
            namespace: 'Alexa',
            payloadVersion: '3',
          },
          payload: {},
        },
      };
      res.send(resp);
      await data;
      return;
    }
  }
  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
