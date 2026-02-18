CREATE TABLE sterilization_report_imports (
    id INT AUTO_INCREMENT PRIMARY KEY,

    autoclave_id INT NOT NULL,

    file_name VARCHAR(255) NOT NULL,
    file_hash VARCHAR(64) NOT NULL,
    file_path VARCHAR(500) NOT NULL,

    import_status ENUM('NEW','PARSED','ERROR') DEFAULT 'NEW',

    error_message TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_file_hash (file_hash),

    FOREIGN KEY (autoclave_id) REFERENCES autoclaves(id)

) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci;
