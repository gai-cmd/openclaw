const { App } = require('@honojs');

const app = new App();

let tasks = [];
let nextTaskId = 1;

app.post('/api/tasks', (c) => {
  const { project_id, name, description, assigned_to, due_date, status } = c.req.body;
  const task = { id: nextTaskId++, project_id, name, description, assigned_to, due_date, status };
  tasks.push(task);
  return c.json(task, 201);
});

app.get('/api/tasks/:taskId', (c) => {
  const taskId = parseInt(c.req.param('taskId'), 10);
  const task = tasks.find(t => t.id === taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
});

app.put('/api/tasks/:taskId', (c) => {
  const taskId = parseInt(c.req.param('taskId'), 10);
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) return c.json({ error: 'Task not found' }, 404);

  const { project_id, name, description, assigned_to, due_date, status } = c.req.body;
  tasks[taskIndex] = { id: taskId, project_id, name, description, assigned_to, due_date, status };
  return c.json(tasks[taskIndex]);
});

app.delete('/api/tasks/:taskId', (c) => {
  const taskId = parseInt(c.req.param('taskId'), 10);
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) return c.json({ error: 'Task not found' }, 404);

  tasks.splice(taskIndex, 1);
  return c.status(204).send();
});

app.listen(3000, () => console.log('API is listening on http://localhost:3000'));