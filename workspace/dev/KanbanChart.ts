// 칸반차트 TypeScript 파일 초기 설계

// Task 카드의 형태를 정의하는 인터페이스
type Task = {
    id: string; // Task ID
    title: string; // Task 제목
    assignee: string; // 담당자
    dueDate: Date; // 마감일
    priority: string; // 우선순위
    progress: number; // 진행률 (0-100)
}

// 칸반 보드의 칼럼을 정의하는 타입
type Column = 'Backlog' | 'To Do' | 'In Progress' | 'Review' | 'Done' | 'Blocked';

// 칸반 보드 클래스를 정의
class KanbanBoard {
    private columns: Map<Column, Task[]>;

    constructor() {
        this.columns = new Map<Column, Task[]>([
            ['Backlog', []],
            ['To Do', []],
            ['In Progress', []],
            ['Review', []],
            ['Done', []],
            ['Blocked', []]
        ]);
    }

    // Task를 컬럼에 추가하는 메소드
    addTask(task: Task, column: Column) {
        this.columns.get(column)?.push(task);
    }

    // Task를 다른 컬럼으로 이동시키는 메소드
    moveTask(taskId: string, from: Column, to: Column) {
        const fromColumnTasks = this.columns.get(from);
        const taskIndex = fromColumnTasks?.findIndex(task => task.id === taskId);
        if (taskIndex !== undefined && taskIndex > -1) {
            const [task] = fromColumnTasks?.splice(taskIndex, 1) as [Task];
            this.columns.get(to)?.push(task);
        }
    }

    // 모든 Task를 반환하는 메소드
    getTasks(column: Column): Task[] | undefined {
        return this.columns.get(column);
    }
}

export { KanbanBoard, Task, Column };