# Snapcache

## Description

An open-source alternative to the Firebase Realtime Database

## How to set up Snapcache server

1. set the redis DB host and timesync redis host to your ip address in server.js, lines 42, 50
2. Make sure redis instance is running, locally or remotely
3. yarn - installs dependencies
3. yarn start - starts the firebase server on port 8080 and 8081

## How do I setup Firebase SDK on client side?

1. Make sure Firebase SDK is installed for the language of your choice
2. In your config file, set `databaseURL: 'ws://<your_firebase_server_ip>:8080'`
3. Firebase SDK APIs work as normal. Follow Firebase tutorials.

## Tutorial - Let's build a TODO app in react that uses the Realtime Database


All the files are in the demo folder.

1. We are using parcel as a lightweight bundler. Run `yarn parcel` from project root to start the bundler

2. main.html

```
<head>
  <link rel='stylesheet' type='text/css' href='./main.css'>
  <title>Todo List</title>
</head>

<body>
  <div id="render-target"></div>
  
  <script src="https://www.gstatic.com/firebasejs/5.5.3/firebase-app.js"></script>
  <script src="https://www.gstatic.com/firebasejs/5.5.3/firebase-database.js"></script>
  <script src='./main.js'></script>
</body>
```

3. Some boilerplate react code - App.js. Some code omitted for brevity. We import firebase SDK and use it as per normal. On `componentDidMount()`, we add a value listener on the tasks collection, so it will subscribe to all value changes on tasks collection and its children. Remember to unsubscribe it on `componentWillUnmount()`.


`_onValueCallback(snapshot)` is the callback function that runs after any changes are made on the Tasks collection and the currently subscribed client is notified. Take note that the entire collection is returned. We are going to `setState` here.

```
import Firebase from './firebase.js'

class App extends Component {
  constructor(props) {
    super(props);
    this.firebase = Firebase

    this.state = {
      hideCompleted: false,
      tasks: [],
    };
  }

  _onValueCallback(snapshot) {
    const taskObjects = snapshot.val() || {}
    const taskList = []
    Object.keys(taskObjects).forEach(key => {
      const newObj = taskObjects[key]
      newObj._id = key
      taskList.push(newObj)
    })
    this.setState({
      tasks: taskList,
      hideCompleted: this.state.hideCompleted,
    })
  }

  componentDidMount() {
    this.firebase.tasks().on('value', this._onValueCallback , (err) => {
      console.log(err)
    })
  }

  componentWillUnmount() {
    this.firebase.tasks().off('value', this._onValueCallback)
  }
}

```

4. Configure your firebase SDK. In config.js:

```
const config = {
  apiKey: process.env.REACT_APP_API_KEY,
  authDomain: process.env.REACT_APP_AUTH_DOMAIN,
  databaseURL: process.env.REACT_APP_DATABASE_URL || 'ws://localhost:8080',
  projectId: process.env.REACT_APP_PROJECT_ID,
  storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
};
```

5. Set up firebase SDK as a singleton. In firebase.js:

```
import firebase from 'firebase/app'
import 'firebase/database'

import config from './config.js'

class Firebase {
	constructor() {
		try {
			firebase.initializeApp(config)
		} catch (err) {
			console.log(err)
		}
		this.db = firebase.database()

		// bind this in functions
		this.tasks = this.tasks.bind(this)
		this.task = this.task.bind(this)
	}

	// **** DATABASE API *****
	tasks() {
		return this.db.ref('tasks')
	}

	task(id) {
		return this.db.ref(`tasks/${id}`)
	}
}

// Singleton!
const FirebaseInstance = new Firebase()

export default FirebaseInstance
```

The class properties are references to the Firebase Realtime DB collections.


6. We need to serve the html and js as static files. In server.js:

```
const express = require('express');
const bodyParser = require('body-parser');
const serveStatic = require('serve-static');
const path = require('path');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(serveStatic(path.join(__dirname, 'dist')));

app.listen(3000, '0.0.0.0', () =>
  console.log('Express server is running on localhost:3000')
);
```


7. `node demo/server.js` from project root

8. Open http://localhost:3000/main.html in your browser! Viola!

