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

const FirebaseInstance = new Firebase()

export default FirebaseInstance