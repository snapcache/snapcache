import React, { Component } from 'react';
import classnames from 'classnames';
import Firebase from './firebase.js'


// Task component - represents a single todo item
export default class Task extends Component {
  constructor(props) {
    super(props)

    // retrieve the db ref
    this.task = Firebase.task(this.props.task._id) 
  }

  _onValueCallback(snapshot) {
    // Update component state here
  }

  componentDidMount() {
    // Normally you can add the listener here. 
    // But there is no need to since the parent component is already listening to changes
    // on all tasks
    this.task.on('value', this._onValueCallback , (err) => {
      console.log(err)
    })
  }

  componentWillUnmount() {
    this.task.off('value', this._onValueCallback)
  }

  toggleChecked() {
    // Set the checked property to the opposite of its current value

    this.task.update({
      'checked': !this.props.task.checked
    })
  }

  deleteThisTask() {
    this.task.remove()
  }

  togglePrivate() {
    this.task.update({
      'private': !this.props.task.private
    })
  }

  render() {
    // Give tasks a different className when they are checked off,
    // so that we can style them nicely in CSS
    const taskClassName = classnames({
      checked: this.props.task.checked,
      private: this.props.task.private,
    });

    return (
      <li className={taskClassName}>
        <button className="delete" onClick={this.deleteThisTask.bind(this)}>
          &times;
        </button>

        <input
          type="checkbox"
          readOnly
          checked={!!this.props.task.checked}
          onClick={this.toggleChecked.bind(this)}
        />

        { this.props.showPrivateButton ? (
          <button className="toggle-private" onClick={this.togglePrivate.bind(this)}>
            { this.props.task.private ? 'Private' : 'Public' }
          </button>
        ) : ''}

        <span className="text">
          <strong>{this.props.task.username}</strong>: {this.props.task.text}
        </span>
      </li>
    );
  }
}
