-- Scripted from the production database (dbo schema only). EF6 code-first created these tables;
-- Price and money columns were later widened by a DBA script, so they are decimal(19,4), not EF's (18,2).
CREATE TABLE dbo.Products (
    Id int IDENTITY PRIMARY KEY,
    Slug nvarchar(200) NOT NULL UNIQUE,
    Name nvarchar(max) NULL,
    Category nvarchar(max) NULL,
    Price decimal(19,4) NOT NULL
);
CREATE TABLE dbo.Orders (
    Id int IDENTITY PRIMARY KEY,
    CustomerEmail nvarchar(max) NULL,
    CreatedUtc datetime NOT NULL,
    Status int NOT NULL,
    DeliveryAddress_Name nvarchar(max) NULL,
    DeliveryAddress_Street nvarchar(max) NULL,
    DeliveryAddress_PostalCode nvarchar(max) NULL,
    DeliveryAddress_City nvarchar(max) NULL,
    Total decimal(19,4) NOT NULL
);
CREATE TABLE dbo.OrderLines (
    Id int IDENTITY PRIMARY KEY,
    ProductId int NOT NULL,
    Quantity int NOT NULL,
    UnitPrice decimal(19,4) NOT NULL,
    Order_Id int NOT NULL REFERENCES dbo.Orders (Id) ON DELETE CASCADE
);
GO
SET IDENTITY_INSERT dbo.Products ON;
INSERT dbo.Products (Id, Slug, Name, Category, Price) VALUES
    (1, 'trail-tent-2p', 'Trail tent 2P', 'tents', 249.0000),
    (2, 'alpine-tent-3p', 'Alpine tent 3P', 'tents', 389.5000),
    (3, 'camp-stove', 'Camp stove', 'cooking', 10.0050);
SET IDENTITY_INSERT dbo.Products OFF;