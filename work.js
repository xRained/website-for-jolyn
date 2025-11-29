document.addEventListener('DOMContentLoaded', function() {
    const supabase = window.supabaseClient;
    if (!supabase) {
        console.error("Supabase client is not initialized.");
        alert("A critical error occurred. Please refresh the page.");
        return;
    }

    // --- State Management ---
    let state = {
        currentUser: null,
        tasks: [],
        notes: [],
        reminders: [],
        documents: [],
        editingTaskId: null,
        calendar: null,
    };

    // --- DOM Element Cache ---
    const DOM = {
        authContainer: document.getElementById('auth-container-work'),
        dashboardContainer: document.querySelector('.dashboard-container'),
        // Tabs
        tabButtons: document.querySelectorAll('.dashboard-tab-button'),
        tabContents: document.querySelectorAll('.dashboard-tab-content'),
        // Tasks
        addTaskForm: document.getElementById('add-task-form'),
        newTaskContent: document.getElementById('new-task-content'),
        newTaskPriority: document.getElementById('new-task-priority'),
        newTaskDueDate: document.getElementById('new-task-due-date'),
        newTaskCategory: document.getElementById('new-task-category'),
        submitTaskButton: document.getElementById('submit-task-button'),
        pinnedTasksContainer: document.getElementById('pinned-tasks-container'),
        pendingTasksContainer: document.getElementById('pending-tasks-container'),
        completedTasksContainer: document.getElementById('completed-tasks-container'),
        sortTasksSelect: document.getElementById('sort-tasks'),
        // Notes
        addNoteForm: document.getElementById('add-note-form'),
        newNoteTitle: document.getElementById('new-note-title'),
        newNoteContent: document.getElementById('new-note-content'),
        notesListContainer: document.getElementById('notes-list-container'),
        // Financial Reminders
        addReminderForm: document.getElementById('add-reminder-form'),
        newReminderContent: document.getElementById('new-reminder-content'),
        newReminderDueDate: document.getElementById('new-reminder-due-date'),
        remindersListContainer: document.getElementById('reminders-list-container'),
        // Documents
        addDocForm: document.getElementById('add-doc-form'),
        newDocName: document.getElementById('new-doc-name'),
        docFileInput: document.getElementById('doc-file-input'),
        docsListContainer: document.getElementById('docs-list-container'),
        // Calendar
        calendarEl: document.getElementById('calendar'),
        eventModal: document.getElementById('event-modal'),
        eventModalTitle: document.getElementById('event-modal-title'),
        eventForm: document.getElementById('event-form'),
        eventId: document.getElementById('event-id'),
        eventTitle: document.getElementById('event-title'),
        eventStart: document.getElementById('event-start'),
        eventEnd: document.getElementById('event-end'),
        eventAllDay: document.getElementById('event-all-day'),
        eventColor: document.getElementById('event-color'),
        eventPriority: document.getElementById('event-priority'),
        eventCategory: document.getElementById('event-category'),
        // Task Modal
        completeEventButton: document.getElementById('complete-event-button'),
        taskModal: document.getElementById('task-modal'),
        taskForm: document.getElementById('task-form'),
        taskId: document.getElementById('task-id'),
        taskModalContent: document.getElementById('task-modal-content'),
        taskModalPriority: document.getElementById('task-modal-priority'),
        taskModalDueDate: document.getElementById('task-modal-due-date'),
    };

    // --- Helper Functions ---
    function formatDate(dateString) {
        if (!dateString) return 'No due date';
        const date = new Date(dateString + 'T00:00:00'); // Treat as local timezone
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function formatTimeAgo(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " years ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " months ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " days ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " hours ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " minutes ago";
        return "just now";
    }

    // Converts date to a format suitable for datetime-local input
    function toDateTimeLocal(date) {
        const ten = i => (i < 10 ? '0' : '') + i;
        return `${date.getFullYear()}-${ten(date.getMonth() + 1)}-${ten(date.getDate())}T${ten(date.getHours())}:${ten(date.getMinutes())}`;
    }


    // --- UI Rendering ---
    function renderTasks() {
        const pinnedTasks = state.tasks.filter(t => t.is_pinned && !t.is_completed);
        const pendingTasks = state.tasks.filter(t => !t.is_pinned && !t.is_completed);
        const completedTasks = state.tasks.filter(t => t.is_completed);

        // Sort pending tasks
        const sortBy = DOM.sortTasksSelect.value;
        pendingTasks.sort((a, b) => {
            if (sortBy === 'priority') {
                const priorityOrder = { 'High': 1, 'Medium': 2, 'Low': 3 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            }
            if (sortBy === 'due_date') {
                return new Date(a.due_date) - new Date(b.due_date);
            }
            return new Date(b.created_at) - new Date(a.created_at); // Default: newest
        });

        DOM.pinnedTasksContainer.innerHTML = pinnedTasks.length ? pinnedTasks.map(createTaskCard).join('') : '<p class="empty-state">No pinned tasks.</p>';
        DOM.pendingTasksContainer.innerHTML = pendingTasks.length ? pendingTasks.map(createTaskCard).join('') : '<p class="empty-state">All caught up!</p>';
        DOM.completedTasksContainer.innerHTML = completedTasks.length ? completedTasks.map(createTaskCard).join('') : '<p class="empty-state">No completed tasks yet.</p>';
    }

    function createTaskCard(task) {
        const isEditing = state.editingTaskId === task.id;
        if (isEditing) {
            return `
                <div class="task-card editing" data-task-id="${task.id}">
                    <textarea class="edit-task-content">${task.task_content}</textarea>
                    <div class="task-card-details">
                        <select class="edit-task-priority">
                            <option value="Low" ${task.priority === 'Low' ? 'selected' : ''}>Low</option>
                            <option value="Medium" ${task.priority === 'Medium' ? 'selected' : ''}>Medium</option>
                            <option value="High" ${task.priority === 'High' ? 'selected' : ''}>High</option>
                        </select>
                        <input type="date" class="edit-task-due-date" value="${task.due_date || ''}">
                    </div>
                    <div class="task-card-actions">
                        <button class="action-button save-edit-button">Save</button>
                        <button class="action-button cancel-edit-button">Cancel</button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="task-card ${task.is_completed ? 'completed' : ''} priority-${task.priority.toLowerCase()}" data-task-id="${task.id}">
                <div class="task-card-header">
                    <button class="action-button complete-button" title="${task.is_completed ? 'Mark as Incomplete' : 'Mark as Complete'}">
                        <span class="icon">${task.is_completed ? '✓' : ''}</span>
                    </button>
                    <p class="task-content">${task.task_content}</p>
                </div>
                <div class="task-card-footer">
                    <div class="task-meta">
                        <span class="task-due-date">${formatDate(task.due_date)}</span>
                        ${task.category ? `<span class="task-category">${task.category}</span>` : ''}
                    </div>
                    <div class="task-card-actions">
                        <button class="action-button pin-button" title="${task.is_pinned ? 'Unpin' : 'Pin'}">${task.is_pinned ? 'Unpin' : 'Pin'}</button>
                        <button class="action-button edit-button" title="Edit">Edit</button>
                        <button class="action-button delete-button" title="Delete">Delete</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderNotes() {
        DOM.notesListContainer.innerHTML = state.notes.length > 0 ? state.notes.map(note => `
            <div class="work-note-card" data-note-id="${note.id}">
                <h3>${note.title}</h3>
                <p>${note.content}</p>
                <div class="card-footer">
                    <span class="timestamp">Saved ${formatTimeAgo(note.created_at)}</span>
                    <button class="action-button delete-button">Delete</button>
                </div>
            </div>
        `).join('') : '<p class="empty-state">No work notes yet. Add one!</p>';
    }

    function renderReminders() {
        DOM.remindersListContainer.innerHTML = state.reminders.length > 0 ? state.reminders.map(reminder => `
            <div class="reminder-card ${reminder.is_paid ? 'paid' : ''}" data-reminder-id="${reminder.id}">
                <p>${reminder.reminder_content || reminder.content}</p>
                <div class="card-footer">
                    <span class="timestamp">Due: ${formatDate(reminder.due_date)}</span>
                    <div class="reminder-actions">
                        <button class="action-button mark-paid-button">${reminder.is_paid ? 'Unmark' : 'Mark as Paid'}</button>
                        <button class="action-button delete-button">Delete</button>
                    </div>
                </div>
            </div>
        `).join('') : '<p class="empty-state">No financial reminders. Add one!</p>';
    }

    function renderDocuments() {
        DOM.docsListContainer.innerHTML = state.documents.length > 0 ? state.documents.map(doc => `
            <div class="document-card" data-doc-id="${doc.id}" data-file-path="${doc.file_path}">
                <p>${doc.document_name || doc.name}</p>
                <div class="card-footer">
                    <span class="timestamp">Uploaded ${formatTimeAgo(doc.created_at)}</span>
                    <div class="doc-actions">
                        <a href="${doc.file_url}" target="_blank" rel="noopener noreferrer" class="action-button">View</a>
                        <a href="${doc.file_url}" download class="action-button">Download</a>
                        <button class="action-button delete-button">Delete</button>
                    </div>
                </div>
            </div>
        `).join('') : '<p class="empty-state">No documents uploaded yet.</p>';
    }

    // --- Data Fetching ---
    async function loadAllData() {
        if (!state.currentUser) return;
        await Promise.all([
            loadTasks(),
            loadNotes(),
            loadReminders(),
            loadDocuments()
        ]);
    }

    async function loadTasks() {
        const { data, error } = await supabase.from('tasks').select('*').eq('user_id', state.currentUser.id).order('created_at', { ascending: false });
        if (error) console.error('Error loading tasks:', error);
        else {
            state.tasks = data;
            renderTasks();
        }
    }

    async function loadNotes() {
        const { data, error } = await supabase.from('work_notes').select('*').eq('user_id', state.currentUser.id).order('created_at', { ascending: false });
        if (error) console.error('Error loading notes:', error);
        else {
            state.notes = data;
            renderNotes();
        }
    }

    async function loadReminders() {
        const { data, error } = await supabase.from('financial_reminders').select('*').eq('user_id', state.currentUser.id).order('due_date', { ascending: true });
        if (error) console.error('Error loading reminders:', error);
        else {
            state.reminders = data;
            renderReminders();
        }
    }

    async function loadDocuments() {
        const { data, error } = await supabase.from('documents').select('*').eq('user_id', state.currentUser.id).order('created_at', { ascending: false });
        if (error) console.error('Error loading documents:', error);
        else {
            state.documents = data;
            renderDocuments();
        }
    }

    // --- Data Manipulation ---
    async function handleAddTask(e) {
        e.preventDefault();
        const content = DOM.newTaskContent.value.trim();
        if (!content) return;

        const newTask = {
            user_id: state.currentUser.id,
            task_content: content, // Match the database column name 'task_content'
            priority: DOM.newTaskPriority.value,
            due_date: DOM.newTaskDueDate.value || null,
            category: DOM.newTaskCategory.value.trim() || null,
        };

        const { data, error } = await supabase.from('tasks').insert(newTask).select().single();
        if (error) {
            alert('Could not add task. ' + error.message);
        } else {
            state.tasks.unshift(data);
            renderTasks();
            DOM.addTaskForm.reset();
        }
    }

    async function handleTaskAction(e) {
        const button = e.target.closest('.action-button');
        if (!button) return;

        const card = e.target.closest('.task-card');
        const taskId = card.dataset.taskId;

        if (button.classList.contains('delete-button')) {
            if (confirm('Are you sure you want to delete this task?')) {
                const { error } = await supabase.from('tasks').delete().eq('id', taskId);
                if (error) alert('Could not delete task.');
                else await loadTasks();
            }
        }

        if (button.classList.contains('complete-button')) {
            const task = state.tasks.find(t => t.id == taskId);
            const { error } = await supabase.from('tasks').update({ is_completed: !task.is_completed }).eq('id', taskId);
            if (error) alert('Could not update task.');
            else await loadTasks();
        }

        if (button.classList.contains('pin-button')) {
            const task = state.tasks.find(t => t.id == taskId);
            const { error } = await supabase.from('tasks').update({ is_pinned: !task.is_pinned }).eq('id', taskId);
            if (error) alert('Could not update task.');
            else await loadTasks();
        }

        if (button.classList.contains('edit-button')) {
            state.editingTaskId = parseInt(taskId);
            renderTasks();
        }

        if (button.classList.contains('cancel-edit-button')) {
            state.editingTaskId = null;
            renderTasks();
        }

        if (button.classList.contains('save-edit-button')) {
            const updatedContent = card.querySelector('.edit-task-content').value.trim();
            const updatedPriority = card.querySelector('.edit-task-priority').value;
            const updatedDueDate = card.querySelector('.edit-task-due-date').value;

            if (!updatedContent) return alert('Task content cannot be empty.');

            const { error } = await supabase.from('tasks').update({
                task_content: updatedContent,
                priority: updatedPriority,
                due_date: updatedDueDate || null
            }).eq('id', taskId);

            if (error) alert('Could not save task.');
            else {
                state.editingTaskId = null;
                await loadTasks();
            }
        }
    }

    async function handleAddNote(e) {
        e.preventDefault();
        const title = DOM.newNoteTitle.value.trim();
        const content = DOM.newNoteContent.value.trim();
        if (!title || !content) return alert('Please provide a title and content for the note.');

        const { error } = await supabase.from('work_notes').insert({ user_id: state.currentUser.id, title, content });
        if (error) alert('Could not save note.');
        else {
            DOM.addNoteForm.reset();
            await loadNotes();
        }
    }

    async function handleNoteDelete(e) {
        const button = e.target.closest('.delete-button');
        if (!button) return;
        const card = e.target.closest('.work-note-card');
        const noteId = card.dataset.noteId;
        if (confirm('Are you sure you want to delete this note?')) {
            const { error } = await supabase.from('work_notes').delete().eq('id', noteId);
            if (error) alert('Could not delete note.');
            else await loadNotes();
        }
    }

    async function handleAddReminder(e) {
        e.preventDefault();
        const content = DOM.newReminderContent.value.trim();
        const dueDate = DOM.newReminderDueDate.value;
        if (!content || !dueDate) return alert('Please provide content and a due date for the reminder.');

        const { error } = await supabase.from('financial_reminders').insert({ user_id: state.currentUser.id, reminder_content: content, due_date: dueDate });
        if (error) alert('Could not add reminder.');
        else {
            DOM.addReminderForm.reset();
            await loadReminders();
        }
    }

    async function handleReminderAction(e) {
        const button = e.target.closest('.action-button');
        if (!button) return;
        const card = e.target.closest('.reminder-card');
        const reminderId = card.dataset.reminderId;

        if (button.classList.contains('delete-button')) {
            if (confirm('Are you sure you want to delete this reminder?')) {
                const { error } = await supabase.from('financial_reminders').delete().eq('id', reminderId);
                if (error) alert('Could not delete reminder.');
                else await loadReminders();
            }
        }

        if (button.classList.contains('mark-paid-button')) {
            const reminder = state.reminders.find(r => r.id == reminderId);
            const { error } = await supabase.from('financial_reminders').update({ is_paid: !reminder.is_paid }).eq('id', reminderId);
            if (error) alert('Could not update reminder.');
            else await loadReminders();
        }
    }

    async function handleAddDocument(e) {
        e.preventDefault();
        const name = DOM.newDocName.value.trim();
        const file = DOM.docFileInput.files[0];
        if (!name || !file) return alert('Please provide a name and select a file to upload.');
        const filePath = `${state.currentUser.id}/documents/${Date.now()}-${file.name}`;
        
        try {
            const { error: uploadError } = await supabase.storage.from('media').upload(filePath, file);
            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);

            const { error: dbError } = await supabase.from('documents').insert({
                user_id: state.currentUser.id,
                document_name: name, // Match the likely database column name
                file_url: publicUrl,
                file_path: filePath
            });
            if (dbError) throw dbError;

            DOM.addDocForm.reset();
            await loadDocuments();

        } catch (error) {
            console.error('Document upload failed:', error);
            alert('Document upload failed. ' + error.message);
        }
    }

    async function handleDocumentAction(e) {
        const target = e.target;

        // Handle Delete Button Click
        if (target.classList.contains('delete-button')) {
            const card = target.closest('.document-card');
            const docId = card.dataset.docId;
            const filePath = card.dataset.filePath;

            if (confirm('Are you sure you want to delete this document? This cannot be undone.')) {
                try {
                    const { error: dbError } = await supabase.from('documents').delete().eq('id', docId);
                    if (dbError) throw dbError;

                    const { error: storageError } = await supabase.storage.from('media').remove([filePath]);
                    if (storageError) console.warn('Could not delete file from storage, but DB entry was removed.', storageError);

                    await loadDocuments();
                } catch (error) {
                    alert('Could not delete document. ' + error.message);
                }
            }
        }

        // Handle Download Button Click
        if (target.classList.contains('action-button') && target.hasAttribute('download')) {
            e.preventDefault(); // Stop the link from downloading immediately
            if (confirm('Do you want to download this file?')) {
                // Force download instead of redirecting
                forceDownload(target.href);
            }
        }
    }
    
    async function forceDownload(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network response was not ok.');
            const blob = await response.blob();
            const objectUrl = window.URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = objectUrl;
            // Extract filename from URL for the download attribute
            a.download = url.substring(url.lastIndexOf('/') + 1);
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(objectUrl);
            a.remove();
        } catch (error) {
            console.error('Download failed:', error);
            alert('Could not download the file. Please try again.');
        }
    }

    // --- Auth & Initialization ---
    function updateUIForAuthState(user) {
        state.currentUser = user;
        const isLoggedIn = !!user;
        document.body.classList.toggle('logged-in', isLoggedIn);
        document.body.classList.toggle('logged-out', !isLoggedIn);
        DOM.authContainer.innerHTML = '';

        if (isLoggedIn) {
            const logoutButton = document.createElement('a');
            logoutButton.href = '#';
            logoutButton.className = 'cta-button';
            logoutButton.textContent = 'Logout';
            logoutButton.addEventListener('click', async (e) => {
                e.preventDefault();
                await supabase.auth.signOut();
            });
            DOM.authContainer.appendChild(logoutButton);
            DOM.dashboardContainer.style.display = '';
            loadAllData();
        } else {
            const loginMessage = document.createElement('p');
            loginMessage.innerHTML = 'Please <a href="index.html">return to the main site</a> to log in.';
            DOM.authContainer.appendChild(loginMessage);
            DOM.dashboardContainer.style.display = 'none';
        }
    }

    function handleTabSwitch(e) {
        const button = e.target.closest('.dashboard-tab-button');
        if (!button) return;

        const targetTabId = button.dataset.tab;

        DOM.tabButtons.forEach(btn => btn.classList.remove('active'));
        DOM.tabContents.forEach(content => content.classList.remove('active'));

        button.classList.add('active');
        document.getElementById(targetTabId).classList.add('active');
    }

    // --- Calendar Logic ---
    function initializeCalendar() {
        if (state.calendar) return; // Already initialized

        state.calendar = new FullCalendar.Calendar(DOM.calendarEl, {
            initialView: 'dayGridMonth',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth'
            },
            editable: true,
            selectable: true,
            windowResize: function(arg) {
                if (window.innerWidth < 768) {
                    state.calendar.setOption('headerToolbar', {
                        left: 'prev,next',
                        center: 'title',
                        right: 'dayGridMonth,listMonth' // Simpler header for mobile
                    });
                } else {
                    state.calendar.setOption('headerToolbar', {
                        left: 'prev,next today',
                        center: 'title',
                        right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth'
                    });
                }
            },
            eventSources: [
                // Source 1: Regular Calendar Events
                {
                    events: async (fetchInfo) => {
                        const { data, error } = await supabase.from('calendar_events')
                            .select('id, title, start_time, end_time, all_day, color, priority') // Removed is_completed and category
                            .eq('user_id', state.currentUser.id)
                            .lt('start_time', fetchInfo.end.toISOString())
                            .or(`end_time.gte.${fetchInfo.start.toISOString()},end_time.is.null`);
                        if (error) throw error;
                        return data.map(e => ({
                            id: e.id,
                            title: e.title,
                            classNames: [
                                e.priority ? `priority-${e.priority.toLowerCase()}` : ''
                            ].filter(Boolean), // Filter out empty strings
                            start: e.start_time,
                            end: e.end_time,
                            allDay: e.all_day,
                            color: e.color,
                            extendedProps: { type: 'event', priority: e.priority, category: e.category }
                        }));
                    }
                },
                // Source 2: Tasks with due dates
                {
                    events: async (fetchInfo) => {
                        const { data, error } = await supabase.from('tasks')
                            .select('*')
                            .eq('user_id', state.currentUser.id)
                            .not('due_date', 'is', null) // Only fetch tasks with a due date
                            .gte('due_date', fetchInfo.startStr.substring(0, 10))
                            .lte('due_date', fetchInfo.endStr.substring(0, 10));
                        if (error) throw error;
                        return data.map(task => ({
                            id: task.id,
                            title: task.task_content,
                            start: task.due_date,
                            allDay: true,
                            classNames: [
                                'fc-event-task',
                                `priority-${task.priority.toLowerCase()}`,
                                task.is_completed ? 'completed' : ''
                            ],
                            extendedProps: {
                                type: 'task',
                                ...task
                            }
                        }));
                    }
                }
            ],
            dateClick: (info) => {
                // This handles clicks on a specific date.
                openEventModal({
                    start: info.date,
                    allDay: true // Assume all-day for a date click
                });
            },
            select: (info) => {
                openEventModal({
                    start: info.start,
                    end: info.end,
                    allDay: info.allDay
                });
            },
            eventClick: (info) => {
                if (info.event.extendedProps.type === 'task') {
                    openTaskModal(info.event.extendedProps);
                } else {
                    openEventModal(info.event);
                }
            },
            eventDrop: async (info) => {
                const { type } = info.event.extendedProps;
                let query;

                if (type === 'task') {
                    // Handle dragging a task to a new date
                    const newDueDate = info.event.start.toISOString().substring(0, 10);
                    query = supabase.from('tasks').update({ due_date: newDueDate }).eq('id', info.event.id);
                } else {
                    // Handle dragging a regular event
                    query = supabase.from('calendar_events').update({
                        start_time: info.event.start.toISOString(),
                        end_time: info.event.end ? info.event.end.toISOString() : null
                    }).eq('id', info.event.id);
                }

                const { error } = await query;
                if (error) {
                    alert('Could not reschedule the item. Reverting.');
                    info.revert();
                } else {
                    // If a task was moved, we also need to refresh the task list view
                    if (type === 'task') {
                        await loadTasks();
                    }
                }
            },
            eventResize: async (info) => {
                const { error } = await supabase.from('calendar_events').update({
                    end_time: info.event.end.toISOString()
                }).eq('id', info.event.id);

                if (error) {
                    alert('Could not resize event. Reverting.');
                    info.revert();
                }
            }
        });

        state.calendar.render();
    }

    function openEventModal(eventData) {
        DOM.eventForm.reset();
        if (eventData.id) { // Editing existing event
            DOM.eventModalTitle.textContent = 'Edit Event';
            DOM.eventId.value = eventData.id;
            DOM.eventTitle.value = eventData.title;
            DOM.eventStart.value = toDateTimeLocal(eventData.start);
            DOM.eventEnd.value = eventData.end ? toDateTimeLocal(eventData.end) : '';
            DOM.eventAllDay.checked = eventData.allDay;
            DOM.eventPriority.value = eventData.extendedProps?.priority || 'Medium';
            DOM.eventCategory.value = eventData.extendedProps?.category || '';
            DOM.eventColor.value = eventData.color || '#f4acb7';
            DOM.completeEventButton.style.display = 'none'; // Hide complete button
            document.getElementById('delete-event-button').style.display = 'inline-block';
        } else { // Adding new event
            DOM.eventModalTitle.textContent = 'Add Event';
            DOM.eventId.value = '';
            DOM.eventPriority.value = 'Medium'; // Default priority
            DOM.eventCategory.value = '';
            DOM.eventStart.value = toDateTimeLocal(eventData.start);
            DOM.eventEnd.value = eventData.end ? toDateTimeLocal(eventData.end) : '';
            DOM.eventPriority.value = 'Medium'; // Ensure default priority is set
            DOM.eventAllDay.checked = eventData.allDay;
            DOM.completeEventButton.style.display = 'none';
            document.getElementById('delete-event-button').style.display = 'none';
        }
        DOM.eventModal.style.display = 'flex';

        // Toggle End Time input based on All Day checkbox
        const endTimeInput = DOM.eventEnd;
        const endTimeLabel = document.querySelector('label[for="event-end"]');
        const toggleEndTimeVisibility = () => {
            const isHidden = DOM.eventAllDay.checked;
            endTimeInput.style.display = isHidden ? 'none' : '';
            endTimeLabel.style.display = isHidden ? 'none' : '';
        };
        toggleEndTimeVisibility();
        DOM.eventAllDay.onchange = () => {
            toggleEndTimeVisibility();
        };
    }

    function openTaskModal(taskData) {
        DOM.taskForm.reset();
        DOM.taskId.value = taskData.id;
        DOM.taskModalContent.value = taskData.task_content;
        DOM.taskModalPriority.value = taskData.priority;
        DOM.taskModalDueDate.value = taskData.due_date;
        
        const completeButton = document.getElementById('complete-task-button');
        completeButton.textContent = taskData.is_completed ? 'Mark as Incomplete' : 'Mark as Complete';
        completeButton.onclick = async () => {
            const { error } = await supabase.from('tasks').update({ is_completed: !taskData.is_completed }).eq('id', taskData.id);
            if (error) alert('Could not update task status.');
            else {
                DOM.taskModal.style.display = 'none';
                state.calendar.refetchEvents();
                await loadTasks(); // Also refresh the list view
            }
        };

        const deleteButton = document.getElementById('delete-task-button');
        deleteButton.onclick = async () => {
            if (confirm('Are you sure you want to delete this task?')) {
                const { error } = await supabase.from('tasks').delete().eq('id', taskData.id);
                if (error) alert('Could not delete task.');
                else {
                    DOM.taskModal.style.display = 'none';
                    state.calendar.refetchEvents();
                    await loadTasks();
                }
            }
        };
        DOM.taskModal.style.display = 'flex';
    }

    async function handleSaveTask(e) {
        e.preventDefault();
        const taskId = DOM.taskId.value;
        if (!taskId) return;

        const updates = {
            task_content: DOM.taskModalContent.value.trim(),
            priority: DOM.taskModalPriority.value,
            due_date: DOM.taskModalDueDate.value || null
        };

        const { error } = await supabase.from('tasks').update(updates).eq('id', taskId);
        if (error) alert('Could not save task: ' + error.message);
        else {
            DOM.taskModal.style.display = 'none';
            state.calendar.refetchEvents();
            await loadTasks(); // Also refresh the list view
        }
    }

    async function handleSaveEvent(e) {
        e.preventDefault();
        const event = {
            user_id: state.currentUser.id,
            title: DOM.eventTitle.value,
            start_time: new Date(DOM.eventStart.value).toISOString(),
            end_time: !DOM.eventAllDay.checked && DOM.eventEnd.value ? new Date(DOM.eventEnd.value).toISOString() : null,
            all_day: DOM.eventAllDay.checked,
            color: DOM.eventColor.value,
            priority: DOM.eventPriority.value
        };

        let query;
        const eventId = DOM.eventId.value;
        if (eventId) {
            // When updating, we don't want to reset the completion status
            query = supabase.from('calendar_events').update(event).eq('id', eventId);
        } else {
            // When inserting
            query = supabase.from('calendar_events').insert(event);
        }

        const { error } = await query;
        if (error) {
            alert('Could not save event: ' + error.message);
        } else {
            state.calendar.refetchEvents();
            DOM.eventModal.style.display = 'none';
        }
    }

    async function handleDeleteEvent() {
        const eventId = DOM.eventId.value;
        if (!eventId || !confirm('Are you sure you want to delete this event?')) return;

        const { error } = await supabase.from('calendar_events').delete().eq('id', eventId);
        if (error) {
            alert('Could not delete event: ' + error.message);
        } else {
            state.calendar.refetchEvents();
            DOM.eventModal.style.display = 'none';
        }
    }

    async function handleCompleteEvent() {
        // This feature is disabled in the workaround.
    }

    function init() {
        // Event Listeners
        DOM.addTaskForm.addEventListener('submit', handleAddTask);
        document.getElementById('tab-tasks').addEventListener('click', handleTaskAction);
        DOM.sortTasksSelect.addEventListener('change', renderTasks);

        DOM.addNoteForm.addEventListener('submit', handleAddNote);
        DOM.notesListContainer.addEventListener('click', handleNoteDelete);

        DOM.addReminderForm.addEventListener('submit', handleAddReminder);
        DOM.remindersListContainer.addEventListener('click', handleReminderAction);

        DOM.addDocForm.addEventListener('submit', handleAddDocument);
        DOM.docsListContainer.addEventListener('click', handleDocumentAction);

        document.querySelector('.dashboard-nav').addEventListener('click', handleTabSwitch);

        // Calendar Modal Listeners
        DOM.eventForm.addEventListener('submit', handleSaveEvent);
        document.getElementById('delete-event-button').addEventListener('click', handleDeleteEvent);
        DOM.completeEventButton.addEventListener('click', handleCompleteEvent);
        DOM.eventModal.querySelector('.close-button').addEventListener('click', () => DOM.eventModal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === DOM.eventModal) DOM.eventModal.style.display = 'none'; });

        // Task Modal Listeners
        DOM.taskForm.addEventListener('submit', handleSaveTask);
        DOM.taskModal.querySelector('.close-button').addEventListener('click', () => DOM.taskModal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === DOM.taskModal) DOM.taskModal.style.display = 'none'; });


        // Auth state change
        supabase.auth.onAuthStateChange((_event, session) => {
            updateUIForAuthState(session?.user);
        });

        // Initial check
        supabase.auth.getSession().then(({ data: { session } }) => {
            updateUIForAuthState(session?.user);
            if (session?.user) {
                // Initialize calendar only after user is logged in
                initializeCalendar();
            }
        });
    }


    init();
});