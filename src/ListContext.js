import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { nanoid } from 'nanoid';
import { ip, network, database } from './appConfig';
import { signQuery, signTransaction } from '@fluree/crypto-utils';
import usersAuth from './data/usersAuth';

//List Context holds all the functionality that will issue transactions and queries from the Fluree DB
const ListContext = React.createContext({});

const ListProvider = (props) => {
  // initial state of the lists array, custom hook to set the lists each time the hook is called
  const [lists, setLists] = useState([]);

  //this useState hook and variable hold my initial value and the custom hook to update the value
  const [inputState, setInputState] = useState({
    name: '',
    description: '',
    listOwner: '',
    tasks: [
      {
        id: `task-${nanoid()}`,
        isCompleted: false,
        task: '',
        assignedTo: '',
      },
    ],
  });
  const [userIsNew, setNewUser] = useState(false);
  const [users, setUsers] = useState([]);
  const [owners, setOwners] = useState([]);
  const [chosenOwner, setChosenOwner] = useState(inputState.listOwner);
  let [selectedUser, setSelectedUser] = useState(usersAuth['rootUser']);

  //this handles the tab change for a user
  const handleUserChange = (event, name) => {
    event.preventDefault();
    setSelectedUser(usersAuth[name]);
  };

  //this handles the changes for the name and description inputs in the form component
  function handleChange(e) {
    const { name, value } = e.target;
    setInputState({
      ...inputState,
      [name]: value,
    });
  }

  //this handles the changes for the inputs in the TasksInput component
  function handleTaskChange(task) {
    let newTasks = inputState.tasks;
    const index = newTasks.findIndex((newTask) => newTask.id === task.id);
    newTasks[index] = task;
    setInputState({ ...inputState, tasks: newTasks });
  }

  //this adds more TaskInputs when the + button is pressed
  function addMoreInputs() {
    let moreTasks = inputState.tasks;
    moreTasks.push({
      id: `task-${nanoid()}`,
      completed: false,
      task: '',
      assignedTo: '',
      email: '',
    });
    setInputState({ ...inputState, tasks: moreTasks });
  }

  //this removes a TaskInput when the - button is pressed
  function removeInputs() {
    let currentTasks = inputState.tasks;
    currentTasks.pop();
    setInputState({ ...inputState, tasks: currentTasks });
  }

  //this clears the form when after the submit button is pressed
  function clearForm() {
    setInputState({
      name: '',
      description: '',
      listOwner: '',
      tasks: [
        {
          id: `task${'-' + Math.floor(Math.random() * 10 + 1)}`,
          completed: false,
          task: '',
          assignedTo: '',
          email: '',
        },
      ],
    });
    setChosenOwner('');
  }

  let baseURL = `${ip}/fdb/${network}/${database}/`;

  //load all the assignee data from fdb on render to propagate the "assignee" Select
  const loadAssignedToData = async () => {
    const response = await axios.post(`${baseURL}query`, {
      select: ['_id', 'email', 'name'],
      from: 'assignee',
      opts: {
        compact: true,
        orderBy: ['ASC', '_id'],
      },
    });
    setUsers(response.data);
  };

  //load all the list-owner data from fdb on render to propagate the "listOwner" Select
  const loadOwnerData = async () => {
    const response = await axios.post(`${baseURL}query`, {
      select: { '?user': ['_id', 'username'] },
      where: [['?list', 'list/listOwner', '?user']],
    });

    const filteredIds = new Set();
    const ownerData = response.data;

    const filterOwnerData = ownerData.filter((el) => {
      const duplicate = filteredIds.has(el._id);
      filteredIds.add(el._id);
      return !duplicate;
    });

    setOwners(filterOwnerData);
  };

  //calls the assignee data and owner data functions
  useEffect(() => {
    loadAssignedToData();
    loadOwnerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // fetches all the list data in the fdb
    const fetchListData = {
      select: [
        '*',
        {
          tasks: [
            '*',
            {
              assignedTo: ['*'],
            },
          ],
        },
      ],
      from: 'list',
      opts: {
        compact: true,
        orderBy: ['ASC', '_id'],
      },
    };
    const privateKey = selectedUser.privateKey;
    const queryType = 'query';
    const host = 'localhost';
    const db = `${network}/${database}`;
    const param = JSON.stringify(fetchListData);
    let signed = signQuery(privateKey, param, queryType, host, db);
    fetch(`http://localhost:8090/fdb/${db}/query`, signed)
      .then((res) => res.json())
      .then((res) => {
        setLists(res);
      })
      .catch((err) => {
        if (/not found/.test(err.message)) {
          return console.log("this didn't work");
        }
      });
  }, [selectedUser]);

  //create a new Assignee in order to select them from the drop down
  function addNewAssignee({ newAssignedTo, email }) {
    const newAssignee = [
      {
        _id: `assignee$${Math.floor(Math.random() * 10 + 1)}`,
        name: newAssignedTo, //the first name of the new assignee
        email: email, //the email of the new assignee
      },
    ];
    // this is the API request that sends the assignee data to Fluree
    let sendAssigneeData = async () => {
      //holds the axios API request
      let transactResponse = await axios.post(
        `${baseURL}transact`, //place your URL followed by this structure: /fdb/[NETWORK-NAME]/[DBNAME-OR-DBID]/transact
        newAssignee //this is the body that contains the list data in FlureeQL
      );
      if (transactResponse.status === 200) {
        //if the transaction response is 200 then load the Assignee data again
        loadAssignedToData();
      }
    };
    sendAssigneeData();
  }

  //adds new assignee on submission of information
  const handleNewAssigneeSubmit = (newAssignee) => {
    addNewAssignee(newAssignee);
  };

  //adds a new list to the DB
  function addList({ name, description, listOwner, tasks }) {
    const newList = {
      _id: 'list$1',
      name,
      description,
      listOwner,
      tasks: [],
    };

    //for each task input information submitted loop through to set all the required predicate information
    tasks.forEach((task, index) => {
      const newTask = {
        //creates a transaction using FlureeQL syntax to send over the new list data to Fluree
        _id: `task$${index}`, //temporary id for the new list data
        name: task.task, //name of the task
        isCompleted: task.completed, //whether the task is completed (boolean)
        assignedTo: task.assignedTo, //this predicate, in the task collection, is of special type ref so it takes the assigne/_id as parameter to reference the assignee data in the assignee collection belonging to that _id value
      };
      newList.tasks.push(newTask); //push each new task into the tasks array in the new list object
    });

    let transactLoad = [newList]; //set the transactLoad to the newList array for use in the transaction

    let sendListData = async () => {
      //holds the axios API request
      let transactResponse = await axios.post(
        `${baseURL}transact`, //place your URL followed by this structure: /fdb/[NETWORK-NAME]/[DBNAME-OR-DBID]/transact
        transactLoad //this is the body that contains the list data in FlureeQL
      );
      if (transactResponse.status === 200) {
        const _id = transactResponse?.data?.tempids['list$1']; // Ask Andrew about this line

        //this filters through the tasks array and matches the assignee to the _ids recieved on render
        const updateTasksWithAssigneeIds = newList.tasks.map((task) => {
          if (!task.assignedTo.email) {
            const existingUser = users.filter(
              (user) => user._id === task.assignedTo
            );
            task.assignedTo = existingUser[0];
          }
          return task;
        });
        newList.tasks = updateTasksWithAssigneeIds; // sets the tasks array to the id changes in updateTasksWithAssigneeIds
        setLists((lists) => [...lists, { ...newList, _id }]); //adds new list data to our UI
      }
    };
    sendListData(); //sends the transaction over to Fluree DB with the list data provided
  }

  //calls the addList function on list submission
  const handleSubmit = (list) => {
    addList(list);
  };

  //deletes the item from Fluree, checks the permissions, and then deletes from UI
  let deleteTaskFromFluree = (chosenTask) => {
    //variables for the signing of the transaction
    const privateKey = selectedUser.privateKey;
    const auth = selectedUser.authId;
    const db = `${network}/${database}`;
    const expire = Date.now() + 120000;
    const fuel = 100000;
    const nonce = 1;
    const tx = JSON.stringify([
      {
        _id: chosenTask._id, //this is the task _id to match to the task data in Fluree
        _action: 'delete', // action key required for deletions
      },
    ]);
    let signedCommandOne = signTransaction(
      auth,
      db,
      expire,
      fuel,
      nonce,
      privateKey,
      tx
    );
    const fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedCommandOne),
    };
    let txID = null;
    fetch(`${baseURL}command`, fetchOpts)
      .then((response) => response.json())
      .then((data) => {
        txID = data;
        //query for the transaction status
        let txQuery = {
          select: ['*'],
          from: ['_tx/id', txID],
          opts: {
            compact: true,
          },
        };
        let fetchData = {
          method: 'POST',
          body: JSON.stringify(txQuery),
          headers: { 'Content-Type': 'application/json' },
        };
        //takes the txID that is returned then queries for the status
        async function queryTransaction() {
          const txRes = await fetch(`${baseURL}query`, fetchData);
          const id = await txRes.json();
          if (id[0].error) {
            //will show alert if response has error
            window.alert('You cannot delete this task');
            return;
          }
          const remainingTasks = lists.map((list) => {
            const indexItem = list.tasks.findIndex(
              (task) => task._id === chosenTask._id
            );
            if (indexItem >= 0) {
              list.tasks.splice(indexItem, 1);
              //deletes the task from the UI
            }
            return list;
          });
          //calls the custom hook to set the lists in the UI
          setLists(remainingTasks);
        }
        //waits for transaction to be recieved from the ledger to the query peer
        setTimeout(() => {
          queryTransaction();
        }, 1000);
      });
  };

  //edits the item in Fluree (task name or their completed status), checks the permissions, and then accepts the edits to the UI
  let editTaskProps = (newTask) => {
    let taskChangeTransact = [
      //sets the transaction to update data, this type of query can include the "_action" : "update", but if it is transact it is inferred
      {
        _id: newTask._id, //the task _id from list
        name: newTask.name, //name of the task, if it is different it will change in Fluree
        isCompleted: newTask.isCompleted, //completed status, if different it will change in Fluree
      },
    ];
    //variables for the signing of the transaction
    const privateKey = selectedUser.privateKey;
    const auth = selectedUser.authId;
    const db = `${network}/${database}`;
    const expire = Date.now() + 120000;
    const fuel = 100000;
    const nonce = 1;
    const tx = JSON.stringify(taskChangeTransact);
    let signedCommandTwo = signTransaction(
      auth,
      db,
      expire,
      fuel,
      nonce,
      privateKey,
      tx
    );
    let txID = null;
    const fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedCommandTwo),
    };
    fetch(`${baseURL}command`, fetchOpts)
      .then((response) => response.json())
      .then((data) => {
        txID = data;
        //query for the transaction status
        let txQuery = {
          select: ['*'],
          from: ['_tx/id', txID],
          opts: {
            compact: true,
          },
        };
        let fetchData = {
          method: 'POST',
          body: JSON.stringify(txQuery),
          headers: { 'Content-Type': 'application/json' },
        };
        //takes the txID that is returned then queries for the status
        async function queryTransaction() {
          const txRes = await fetch(`${baseURL}query`, fetchData);
          const id = await txRes.json();
          if (id[0].error) {
            window.alert('You cannot edit this task');
            return;
          }
          //maps through each list
          const editedTaskList = lists.map((list) => {
            const index = list.tasks.findIndex(
              (task) => task._id === newTask._id
            ); //match task on _id

            if (index >= 0) {
              list.tasks[index] = newTask; //sets the selected task to the newTask with changes
            }
            return list;
          });
          //calls the custom hook to set the lists in the UI
          setLists(editedTaskList);
        }
        //waits for transaction to be recieved from the ledger to the query peer
        setTimeout(() => {
          queryTransaction();
        }, 1000);
      });
  };

  return (
    <ListContext.Provider //this provides all the state and functionality to every component within in it
      value={{
        lists,
        deleteTaskFromFluree,
        editTaskProps,
        handleSubmit,
        handleNewAssigneeSubmit,
        handleUserChange,
        selectedUser,
        addList,
        chosenOwner,
        setChosenOwner,
        inputState,
        setInputState,
        users,
        setUsers,
        owners,
        setOwners,
        userIsNew,
        setNewUser,
        handleChange,
        handleTaskChange,
        addMoreInputs,
        removeInputs,
        clearForm,
      }}
    >
      {props.children}
    </ListContext.Provider>
  );
};

export { ListProvider, ListContext };
