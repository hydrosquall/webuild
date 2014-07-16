var express = require('express'),
  fs = require('fs'),
  http = require('http'),
  moment = require('moment'),
  events = require('./events'),
  whitelistEvents = require('./events/whitelistEvents'),
  blacklistEvents = require('./events/blacklistEvents'),
  request = require('request'),
  jf = require('jsonfile'),
  githubFeed = require('./repos/github_feed'),
  passport = require('passport'),
  strategy = require('./events/setup-passport'),
  ghConfig = require('./repos/config.js'),
  app = express(),
  podcastApiUrl = 'http://live.webuild.sg/api/podcasts.json';

var githubJson = { repos: [] },
  eventsJson = [];

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.use(express.compress());
  app.use('/public', express.static(__dirname + '/public'));
  app.use(express.favicon(__dirname + '/public/favicon.ico'));

  app.use(express.errorHandler());
  app.locals.pretty = true;
  app.locals.moment = require('moment');

  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser());
  app.use(express.session({secret: 'webuild_session' + new Date().toISOString()}));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(app.router);
});

function timeComparer(a, b) {
  return (moment(a.formatted_time, events.timeFormat).valueOf() -
          moment(b.formatted_time, events.timeFormat).valueOf());
}

function updateEventsJson() {
  eventsJson = whitelistEvents;
  console.log('Updating the events feed...');

  function addEvents(type) {
    events['get' + type +'Events']().then(function(data) {
      whiteEvents = data.filter(function(evt) { // filter black listed ids
        return blacklistEvents.some(function(blackEvent) {
          return blackEvent.id !== evt.id;
        });
      });
      eventsJson = eventsJson.concat(whiteEvents);
      eventsJson.sort(timeComparer);
      console.log(data.length + ' %s events added! %s total', type, eventsJson.length);
    }).catch(function(err) {
      console.error('Failed to add %s events: %s', type, err);
    });
  }
  addEvents('Meetup');
  addEvents('Facebook');
}

app.get('/', function(req, res) {
  res.render('index.jade', {
    github: githubJson.repos.slice(0, 10),
    events: eventsJson.slice(0, 10)
  });
});

app.get('/api/events', function(req, res) {
  res.send(eventsJson);
});

app.get('/api/github', function(req, res) {
  res.send(githubJson);
});

app.get('/admin', function(req, res) {
  res.render('facebook_login.jade', {
    auth0: require('./events/config').auth0,
    error: req.query.error ? true : false,
    user: req.query.user ? req.query.user : '',
  });
});

app.get('/callback', function(req, res, next) {
  passport.authenticate('auth0', function(err, user, info) {
    if (err) {
      console.log('Auth0 Error:' + err)
      return next(err); // will generate a 500 error
    } else if (!user) {
      console.log('Unknown user logging with FB');
      return res.redirect('/admin?error=1');
    }
    return res.redirect('/admin?user=' + user.displayName);
  })(req, res, next);
});

app.post('/api/events/update', function(req, res) {
  if (req.param('secret') !== process.env.WEBUILD_API_SECRET) {
    res.send(503, 'Incorrect secret key');
  }
  updateEventsJson();
  res.send(200, 'Events feed updating...');
})

app.post('/api/repos/update', function(req, res) {
  if (req.param('secret') !== process.env.WEBUILD_API_SECRET) {
    res.send(503, 'Incorrect secret key');
    return;
  }
  githubFeed.update()
    .then(function(feed) {
      console.log('GitHub feed generated');
      githubJson = feed;
      jf.writeFile(__dirname + ghConfig.outfile, feed);
    });
  res.send(200, 'Updating the repos feed; sit tight!');
});

app.use('/api/podcasts', function(req, res) {
 var url = podcastApiUrl;
 req.pipe(request(url)).pipe(res);
});

fs.exists(__dirname + ghConfig.outfile, function(exists) {
  if (exists) {
    jf.readFile(__dirname + ghConfig.outfile, function(err, feed) {
      if (!err) {
        githubJson = feed;
      }
    });
  } else {
    console.log('Fetching public repos feed...');
    request('http://webuild.sg/repos.json', function(err, res, body) {
      if (!err && res.statusCode === 200) {
        console.log('Cached public repos feed');
        githubJson = body;
        jf.writeFile(__dirname + ghConfig.outfile, body);
      } else {
        if (res) {
          console.warn('Failed to retrieve data (Status code: %s)', res.statusCode);
        }
        else {
          console.warn('Failed to retrieve data (Status code: %s)', err);
        }
      }
    });
  }
});
updateEventsJson();

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
