import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import Task from './Task.js';
import Firebase from './firebase.js'

// App component - represents the whole app
class App extends Component {
  constructor(props) {
    super(props);
    this.firebase = Firebase


    this.state = {
      hideCompleted: false,
      tasks: [],
    };

    this.componentDidMount = this.componentDidMount.bind(this)
    this.componentWillUnmount = this.componentWillUnmount.bind(this)
    this._onValueCallback = this._onValueCallback.bind(this)
    this.toggleHideCompleted = this.toggleHideCompleted.bind(this)
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

  handleSubmit(event) {
    event.preventDefault();

    // Find the text field via the React ref
    const text = ReactDOM.findDOMNode(this.refs.textInput).value.trim();

    const newTaskID = this.firebase.tasks().push({
      text,
      createdAt: new Date(),
    })

    // Clear form
    ReactDOM.findDOMNode(this.refs.textInput).value = '';
  }

  toggleHideCompleted() {
    this.setState({
      hideCompleted: !this.state.hideCompleted,
    });
  }

  renderTasks() {
    let filteredTasks = this.state.tasks || [];
    if (this.state.hideCompleted) {
      filteredTasks = filteredTasks.filter(task => !task.checked);
    }
    return filteredTasks.map((task) => {
      const currentUserId = this.props.currentUser && this.props.currentUser._id;
      const showPrivateButton = task.owner === currentUserId;

      return (
        <Task
          key={task._id}
          task={task}
          showPrivateButton={showPrivateButton}
        />
      );
    });
  }

  render() {
    return (
      <div className="container">
        <header>
          <h1>Todo List ({this.props.incompleteCount})</h1>

          <label className="hide-completed">
            <input
              type="checkbox"
              readOnly
              checked={this.state.hideCompleted}
              onClick={this.toggleHideCompleted.bind(this)}
            />
            Hide Completed Tasks
          </label>

          <form className="new-task" onSubmit={this.handleSubmit.bind(this)} >
              <input
                type="text"
                ref="textInput"
                placeholder="Type to add new tasks"
              />
          </form>
        </header>

        <ul>
          {this.renderTasks()}
        </ul>
      </div>
    );
  }
}

export default App
